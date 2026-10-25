"""Local browser guardrails, not an authentication boundary."""
from starlette.responses import JSONResponse


class LocalRequestGuards:
    def __init__(self, app, allowed_origins):
        self.app = app
        self.allowed_origins = set(allowed_origins)

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] not in {'POST', 'PATCH', 'PUT', 'DELETE'}:
            return await self.app(scope, receive, send)
        headers = dict(scope['headers'])
        origin = headers.get(b'origin', b'').decode('latin1')
        same_origin = scope.get('scheme', 'http') + '://' + headers.get(b'host', b'').decode('latin1')
        if (origin and origin not in self.allowed_origins and origin != same_origin) or (not origin and headers.get(b'sec-fetch-site') == b'cross-site'):
            return await JSONResponse({'detail': 'Cross-origin mutation is not allowed'}, status_code=403)(scope, receive, send)
        # CSV has its own streaming bound. JSON endpoints previously buffered unbounded bodies.
        if scope['path'] == '/api/transactions/import':
            return await self.app(scope, receive, send)
        limit = 256 * 1024
        size = 0
        chunks = []
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            chunk = message.get('body', b'')
            size += len(chunk)
            if size > limit:
                return await JSONResponse({'detail': 'Request exceeds 256 KiB JSON limit'}, status_code=413)(scope, receive, send)
            chunks.append(chunk)
            if not message.get('more_body', False):
                break
        delivered = False
        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type':'http.request', 'body':b''.join(chunks), 'more_body':False}
            return await receive()
        await self.app(scope, bounded_receive, send)
