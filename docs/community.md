# Community: your Grove inside Arynwood

**Community** is where your people share a calendar, tasks, lists, notes, files, a board,
messages and a website. It lives on a **Grove**: [Arynwood Grove](https://github.com/Arynwood-Technology/arynwood-community),
a separate service that keeps the accounts and spaces. Since 0.4.9 the whole Community opens
inside Arynwood, on the Community page, instead of in a browser. Since 0.5.2 its screens match
Arynwood Grove 0.7.1, and they need a Grove on 0.7.1 or later: with an older Grove, the
sections it doesn't have yet show errors until it is updated.

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

A space's owners manage it from **Manage space**: rename it, give it a topic that everyone
sees under its name, make other members owners (or members again), remove people, and delete
the space for everyone after typing its name. A space always keeps at least one owner. Tasks
can be assigned to anyone in the space from Tasks or the Calendar; a private task, which only
you can see, only to yourself. Managing a space needs Arynwood Grove 0.4.2 or later; an older
Grove says it needs updating.

To join a Grove someone invited you to, choose **Join with an invitation link** and paste
it. If the link is for a different Grove, Arynwood asks before switching to it.

## What's on the Community page

Grove's menu runs down the left of the page:

- **Talk:** Public chat (when the Grove opens an IRC room to its members; otherwise the host's
  own IRC client), Messages between members, with photos and files, the space's updates log,
  the Board, and Mail for the host.
- **Organize:** Overview, Calendar, Tasks, Lists, Notes and Files. Files keeps versions, shows
  pictures and text, and downloads go to your Downloads folder.
- **Settings:** People & identity, Grove admin (owners and managers), Look & feel (owners) and
  Workspace setup (space owners).
- **Webmaster tools / Website preview:** the Grove's website, its site editor with a live
  preview, and notes left on pages. **Visit the site** and a preview's **Open in a new tab**
  open in your browser.

A Grove's own look (Look & feel) colours the Community page only; Arynwood's window, title and
icon stay Arynwood's. Notifications for new messages or Public chat, if you turn them on in
People & identity, come from the desktop app.

The host's IRC client and Mail are the host's own connections, configured on the Grove. Grove
0.7 has no peer-to-peer messages; Messages replaces them.

## What Arynwood does with your Grove sign-in

The Community page talks to your Grove through Arynwood's own backend, which keeps the Grove
sign-in so you stay signed in after a restart. It contacts only the Grove you chose, and only
the parts of it the Community page uses. It never forwards Arynwood's own API key or
cookies, and it doesn't follow a Grove's redirects to another address. Files and photos keep
the Grove's own content policy, so one opened from Arynwood's address can't run as a page.

Website previews are signed addresses the Grove hands out, valid for an hour. Arynwood's
backend serves them at the same address, without your Grove sign-in. They run sandboxed, as
on the Grove, and only Arynwood's own page can show them in a frame.

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
