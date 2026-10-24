# Community screens: origin and license

The files in this folder are the Community screens of
[Arynwood Grove](https://github.com/Arynwood-Technology/arynwood-community), where they are
published under the GNU AGPL-3.0-only, the same [license](../../../LICENSE) as the rest of
Arynwood MCP. Both have the same copyright holder.

Changes for Arynwood MCP: every request, live notice and socket goes through Arynwood's
backend (`lib/grove.ts`, `backend/routers/community.py`), which holds the Grove sign-in, and
so do the pictures and addresses the Grove hands out (its logo, login picture and photos);
website previews are served by Arynwood's backend at the address the Grove gives them;
invitation links name the Grove's own address; joining from an invitation link stays inside
the app; downloads are saved as files; outside links open in the system browser; a Grove's
look colours the Community page only, not the app's window, title or icon; and `arynwood.css`
fits the members' page into the Community page. They match Arynwood Grove 0.7.1.
