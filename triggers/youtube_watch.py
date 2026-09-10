import asyncio

from backend.services.youtube_pipeline import run_watch_loop

if __name__ == "__main__":
    try:
        asyncio.run(run_watch_loop())
    except KeyboardInterrupt:
        pass
