import asyncio

import pytest

from backend.services.gpu_jobs import GPUJobCancelled, GPUJobQueue


async def test_serializes_two_jobs_in_submission_order():
    queue = GPUJobQueue()
    order: list[str] = []

    async def run(job_id: str):
        async with queue.acquire(job_id):
            order.append(f"{job_id}:start")
            await asyncio.sleep(0.05)
            order.append(f"{job_id}:end")

    first = asyncio.create_task(run("a"))
    await asyncio.sleep(0.01)  # let "a" claim the queue before "b" is submitted
    second = asyncio.create_task(run("b"))
    await asyncio.gather(first, second)

    assert order == ["a:start", "a:end", "b:start", "b:end"]


async def test_cancel_removes_a_queued_job_before_it_runs():
    queue = GPUJobQueue()
    ran: list[str] = []

    async def blocker():
        async with queue.acquire("blocker"):
            await asyncio.sleep(0.1)

    async def victim():
        with pytest.raises(GPUJobCancelled):
            async with queue.acquire("victim"):
                ran.append("victim")  # should never happen

    blocker_task = asyncio.create_task(blocker())
    await asyncio.sleep(0.01)
    victim_task = asyncio.create_task(victim())
    await asyncio.sleep(0.01)

    assert queue.queue_position("victim") == 1  # index 0 is the running blocker
    cancelled = await queue.cancel("victim")
    assert cancelled is True

    await asyncio.gather(blocker_task, victim_task)
    assert ran == []


async def test_cancel_returns_false_for_a_running_job():
    queue = GPUJobQueue()

    async def run():
        async with queue.acquire("running-job"):
            await asyncio.sleep(0.05)
            # too late to cancel now - it's already running
            assert await queue.cancel("running-job") is False

    await run()


async def test_priority_job_jumps_the_queue():
    queue = GPUJobQueue()
    order: list[str] = []

    async def run(job_id: str, priority: bool = False, delay: float = 0.05):
        async with queue.acquire(job_id, priority=priority):
            order.append(job_id)
            await asyncio.sleep(delay)

    blocker_task = asyncio.create_task(run("blocker"))
    await asyncio.sleep(0.01)  # blocker is now running, holds the slot
    normal_task = asyncio.create_task(run("normal"))
    await asyncio.sleep(0.01)  # normal is now queued behind blocker
    priority_task = asyncio.create_task(run("urgent", priority=True))

    await asyncio.gather(blocker_task, normal_task, priority_task)
    assert order == ["blocker", "urgent", "normal"]


async def test_queue_depth_and_position():
    queue = GPUJobQueue()

    async def hold(job_id: str, release: asyncio.Event):
        async with queue.acquire(job_id):
            await release.wait()

    release = asyncio.Event()
    running = asyncio.create_task(hold("running", release))
    await asyncio.sleep(0.01)

    waiting = asyncio.create_task(hold("waiting", asyncio.Event()))
    await asyncio.sleep(0.01)

    assert queue.queue_depth() == 2
    assert queue.queue_position("running") == 0
    assert queue.queue_position("waiting") == 1
    assert queue.queue_position("nonexistent") is None

    release.set()
    await asyncio.sleep(0.01)
    waiting.cancel()
    running.cancel()
    for t in (running, waiting):
        try:
            await t
        except asyncio.CancelledError:
            pass
