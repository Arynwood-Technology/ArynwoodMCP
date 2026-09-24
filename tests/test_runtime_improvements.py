import json
import os
from unittest.mock import AsyncMock

import aiosqlite
import httpx
import pytest
from backend.services import context_budget, providers, ollama_client, memory_index, memory_store, runtime_context, knowledge
from backend.routers import chat


@pytest.mark.parametrize('tools', [None, [{'type':'function','function':{'name':'test','parameters':{'type':'object'}}}]])
def test_budget_includes_tools_and_preserves_complete_turns(tools):
    messages = [{'role':'system','content':'Be useful.'}, {'role':'user','content':'old '*1500},
                {'role':'assistant','content':'old answer'}, {'role':'user','content':'current'},
                {'role':'assistant','content':'','tool_calls':[{'function':{'name':'test','arguments':{}}}]},
                {'role':'tool','tool_name':'test','content':'result '*2000}]
    fitted, report = context_budget.fit_request(messages, tools, 2048)
    assert context_budget.request_tokens(fitted, tools) <= report['budget_tokens']
    assert [m['role'] for m in fitted] == ['system','user','assistant','tool']
    assert report['dropped_turns'] == 1
    assert len(messages[-1]['content']) > len(fitted[-1]['content'])  # no mutation


def test_oversized_current_request_is_explicit_error():
    with pytest.raises(context_budget.ContextBudgetError):
        context_budget.fit_request([{'role':'user','content':'x'*10000}], None, 2048)


async def test_ollama_stream_preserves_structured_calls(monkeypatch):
    class Client:
        async def chat(self, **kwargs):
            async def chunks():
                yield {'message':{'content':'','tool_calls':[{'function':{'name':'web_search','arguments':{'query':'weather'}}}]}, 'done':True}
            return chunks()
    monkeypatch.setattr(ollama_client, 'get_async_client', lambda *a, **k: Client())
    chunks = [c async for c in ollama_client.chat_stream(model='m',messages=[])]
    assert chunks[0]['tool_calls'][0]['function']['name'] == 'web_search'


async def test_structured_tool_call_executes_and_is_not_shown(monkeypatch):
    async def stream(**kwargs):
        if kwargs['messages'][-1]['role'] == 'tool':
            yield {'token':'Found it.', 'done':True}
        else:
            yield {'token':'', 'done':True, 'tool_calls':[{'id':'a','function':{'name':'web_search','arguments':'{"query":"weather"}'}}]}
    monkeypatch.setattr(ollama_client, 'chat_stream', stream)
    call = AsyncMock(return_value='result')
    monkeypatch.setattr(chat, '_call_native_tool', call)
    sink = chat._HttpSink()
    result = await chat._stream_reply(sink, [{'role':'user','content':'weather'}], 'm','h',1,8192,None,chat._NATIVE_TOOLS)
    assert result == sink.text == 'Found it.'
    call.assert_awaited_once_with('web_search', {'query':'weather'}, None)


async def test_memory_collection_failure_is_nonfatal(monkeypatch):
    monkeypatch.setattr(ollama_client, 'aembed_texts', AsyncMock(return_value=[[0.1,0.2]]))
    monkeypatch.setattr(memory_index, '_ensure_collection', AsyncMock(side_effect=ConnectionError('down')))
    assert await memory_index.index_memory(1,'x','y') is False


async def test_native_memory_search_keeps_trust_expiry_and_scope(client, monkeypatch):
    async with aiosqlite.connect(os.environ['ARYNWOOD_DB_PATH']) as db:
        db.row_factory = aiosqlite.Row
        ids=[]
        for title, status, volatility, updated, scope in (
            ('probe-live','provisional','durable','2026-01-01',None),
            ('probe-old','confirmed','transient','2000-01-01',None),
            ('probe-other','confirmed','durable','2026-01-01',99)):
            cur = await db.execute('INSERT INTO arynwood_memory(title,content,status,volatility,updated_at,project_id) VALUES (?,?,?,?,?,?)',
                                   (title,'probe',status,volatility,updated,scope))
            ids.append(cur.lastrowid)
        await db.commit()
        monkeypatch.setattr(memory_index,'search_relevant_memory_ids',AsyncMock(return_value=ids))
        text = await chat._call_native_tool('search_memory', {'query':'probe'}, db)
        assert 'probe-live' in text and 'provisional' in text
        assert 'probe-old' not in text and 'probe-other' not in text


async def test_revision_accept_reject_preserves_history(client, monkeypatch):
    memory=client.post('/api/memory',json={'title':'revision-probe','content':'confirmed original'}).json()
    async with aiosqlite.connect(os.environ['ARYNWOOD_DB_PATH']) as db:
        db.row_factory=aiosqlite.Row
        await chat._process_memories('<remember title="revision-probe">proposed</remember>', db)
    revisions=client.get(f"/api/memory/{memory['id']}/revisions").json()
    pending=revisions[0]
    current=next(m for m in client.get('/api/memory').json() if m['id']==memory['id'])
    assert current['content']=='confirmed original' and current['pending_revision']['id']==pending['id']
    assert client.post(f"/api/memory/{memory['id']}/revisions/{pending['id']}/accept").status_code==200
    current=next(m for m in client.get('/api/memory').json() if m['id']==memory['id'])
    assert current['content']=='proposed' and current['status']=='confirmed'
    revisions=client.get(f"/api/memory/{memory['id']}/revisions").json()
    assert any(r['content']=='confirmed original' and r['state']=='archived' for r in revisions)


async def test_lexical_search_works_without_embeddings_and_excludes_superseded(client, monkeypatch):
    async with aiosqlite.connect(os.environ['ARYNWOOD_DB_PATH']) as db:
        cur=await db.execute("INSERT INTO knowledge_sources(title,source,index_state) VALUES ('rare','rare.txt','active')")
        sid=cur.lastrowid
        payload={'source_id':sid,'title':'rare','source':'rare.txt','text':'orbitalwidget_123 exact identifier'}
        await db.execute('INSERT INTO knowledge_chunks(id,source_id,text,payload) VALUES (?,?,?,?)',('rare-test',sid,payload['text'],json.dumps(payload)))
        await db.commit()
        monkeypatch.setattr(knowledge,'get_embedding',AsyncMock(return_value=None))
        assert any(r['source_id']==sid for r in await knowledge.search('orbitalwidget_123'))
        await db.execute('UPDATE knowledge_sources SET superseded_by=999 WHERE id=?',(sid,))
        await db.commit()
        assert not any(r['source_id']==sid for r in await knowledge.search('orbitalwidget_123'))


async def test_compatible_stream_accumulates_fragmented_calls(monkeypatch):
    frames=[{'choices':[{'index':0,'delta':{'tool_calls':[{'index':0,'id':'call_x','function':{'name':'web_search','arguments':'{"query":'}}]}}]},
            {'choices':[{'index':0,'delta':{'tool_calls':[{'index':0,'function':{'arguments':'"weather"}'}}]},'finish_reason':'tool_calls'}]}]
    def handler(request):
        assert request.url.path=='/v1/chat/completions'
        assert request.headers['authorization']=='Bearer secret-test'
        return httpx.Response(200,text='\n\n'.join('data: '+json.dumps(f) for f in frames)+'\n\ndata: [DONE]\n')
    factory=httpx.AsyncClient
    monkeypatch.setattr(providers.httpx,'AsyncClient',lambda **kwargs:factory(transport=httpx.MockTransport(handler),**kwargs))
    events=[e async for e in providers.stream({'host':'https://example.test/v1','auth_token':'secret-test'},model='m',messages=[])]
    assert events[-1]['tool_calls'][0]['function']['arguments']=='{"query":"weather"}'


def test_provider_credentials_do_not_leak_to_local_helpers():
    token=providers.active_provider.set({'host':'https://remote.test','type':'openai','auth_token':'secret'})
    try:
        assert providers.for_endpoint('http://localhost:11434') is None
        assert providers.for_endpoint('https://remote.test')['auth_token']=='secret'
    finally:
        providers.active_provider.reset(token)
