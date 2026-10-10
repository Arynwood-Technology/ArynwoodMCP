# Community: your Grove inside Arynwood

**Community** is where your people share a calendar, tasks, lists, notes, a board and a
discussion. It lives on a **Grove**: [Arynwood Grove](https://github.com/Arynwood-Technology/arynwood-community),
a separate service that keeps the accounts and spaces. Since 0.4.9 the whole Community opens
inside Arynwood, on the Community page, instead of in a browser.

A Grove can be:

- **On this computer** (the default, `http://127.0.0.1:8018`). Arynwood can start and stop it,
  and it keeps running for your members when you close Arynwood. Only people at this computer
  can reach it.
- **On a server** your members reach, such as `https://community.arynwood.com` or one you set up
  with Grove's installer. Everyone opens the same Grove from their own computer, so there is
  nothing to sync.

## Choose your Grove

On the Community page, the bar at the top shows which Grove you're using and whether it's
running. **Change Grove** takes a server's `https://` address; **Back to …** returns to the
Grove on this computer. A Grove on another computer must use `https://`, because your Grove
password is sent to it. Changing Grove signs you out of the previous one.

Installers can set the default with `ARYNWOOD_COMMUNITY_URL` (see
[supported-platforms.md](supported-platforms.md)); the choice made on the page overrides it.

## Sign in, spaces and invitations

The first person to create an account on a new Grove becomes its host. Anyone else joins
through an invitation: in a space, **Invite members** makes a one-use link, and a space owner
can also turn on a reusable public link. An invitation link names the Grove's own address,
so a link from a Grove on this computer opens only on this computer.

To join a Grove someone invited you to, choose **Join with an invitation link** and paste
it. If the link is for a different Grove, Arynwood asks before switching to it.

The host also sees IRC rooms, private peer messages (NKN) and Mail. These are the host's own
connections, configured on the Grove.

## What Arynwood does with your Grove sign-in

The Community page talks to your Grove through Arynwood's own backend, which keeps the Grove
sign-in so you stay signed in after a restart. It contacts only the Grove you chose, and only
the parts of it the Community page uses. It never forwards Arynwood's own API key or
cookies, and it doesn't follow a Grove's redirects to another address.

Anything on this computer that can use Arynwood's API can also act as your Grove account
there. That is the same single-owner boundary as the rest of Arynwood; see
[SECURITY.md](../SECURITY.md).

## FAQ

**Can I use Arynwood Community without running a server?**
Yes. A Grove on this computer works for you and anyone using this computer. To include people
elsewhere, run the Grove on a server with HTTPS and choose its address with Change Grove.

**Where are my Community messages, calendars and notes stored?**
On the Grove: in its own database on this computer or on its server. Arynwood keeps only
which Grove you chose and your sign-in. Your AI chats, memories and knowledge base are not
sent to the Grove.

**Do I have to sign in to Community to use Arynwood's AI features?**
No. The Grove sign-in applies to the Community page only. Chat, design, studios and tools work
the same without it.
