# Community screens: origin and license

The files in this folder are the Community screens of
[Arynwood Grove](https://github.com/Arynwood-Technology/arynwood-community), where they are
published under the GNU AGPL-3.0-only. Their copyright holder, the same as this repository's,
also licenses them for Arynwood MCP under this repository's [license](../../../LICENSE).

Changes for Arynwood MCP: every request, live notice and socket goes through Arynwood's
backend (`lib/grove.ts`, `backend/routers/community.py`), which holds the Grove sign-in;
invitation links name the Grove's own address; joining from an invitation link stays inside
the app; space exports download as files; and the peer-identity form sends the Grove's
request header.
