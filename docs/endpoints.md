# Endpoints: run chat and images on another computer

Arynwood MCP is one program for every computer. Features that need an NVIDIA GPU are
marked, and an **endpoint** — a model server on another computer — can fill the gap:

- **Chat** can use any Ollama server, or any server with an OpenAI-compatible API.
- **Image generation** in Design Center can use any server with an OpenAI-compatible
  images API, instead of Stable Diffusion on this computer.

This is how Arynwood runs well on a computer without a GPU, such as a laptop or a rented
desktop server: the app, your files, your memory and your knowledge base stay on this
computer, and only the model work goes to the endpoint. To switch off the GPU tools on such
a computer, see [CPU mode](supported-platforms.md#cpu-mode).

## Connect an endpoint for chat

1. Open **Servers** and choose **Add server**.
2. Fill in:
   - **Host or URL**: a bare host for Ollama (`192.168.1.20`, port `11434`), or a full
     URL for an OpenAI-compatible server (`https://api.example.com/v1`; the port is then
     ignored).
   - **Type**: `ollama` or `openai-compatible`.
   - **Auth token**: the server's API key, if it needs one. It stays in Arynwood's backend;
     the page never shows it again.
   - **Chat model**: for an OpenAI-compatible server, the model name that server uses. Leave
     it blank for Ollama, so each persona keeps its own model.
3. Choose **Use for chat**. Arynwood remembers the choice: it opens on that server next
   time too. The Dashboard's server menu changes it as well.

The status drawer (the dot at the bottom of the sidebar) shows whether the server answers,
and whether it lists the model.

## Connect an endpoint for images

1. Add the server as above, with type `openai-compatible`.
2. On its card, type the **Image model** the server offers and choose **Use for images**.
3. Open **Design Center**, then **AI Gen**. The panel says where images come from.

Through an endpoint, Design Center sends the prompt (with the style you picked) and, for
image-to-image, the base image. Checkpoints, trained LoRAs, the negative prompt, steps and
CFG belong to local Stable Diffusion and are hidden while an endpoint is in use. Servers
accept only certain sizes; if one refuses a size, its message is shown. **Stop** on the
server's card goes back to local Stable Diffusion.

## Keep a remote Ollama private

Ollama has no login. Anyone who can reach its port can run models on that computer, and pull
or delete models. Never open it to the internet. Instead:

- **A private network** such as WireGuard: give the GPU computer and this computer private
  addresses, and use the GPU computer's private address as the host.
- **An SSH tunnel**: `ssh -N -L 11435:127.0.0.1:11434 user@gpu-computer`, then add a server
  with host `localhost`, port `11435`. The tunnel must be running while you chat.
- **An HTTPS proxy that checks a token** in front of Ollama: add the server with its
  `https://` URL and the token.

An OpenAI-compatible service with an API key is reached over HTTPS and needs none of this.

## What goes to the endpoint, and what stays here

**Sent to a chat endpoint, every turn:** your message, the conversation history, the
persona's instructions, and what Arynwood adds to the prompt: relevant memories, knowledge
base excerpts, web search results, your Agent Config notes and tool results. Treat the
endpoint like any service you give your conversations to.

**Sent to an image endpoint:** the prompt, and the base image for image-to-image.

**Stays on this computer:** the app, the database, your files, memories and knowledge base,
and the knowledge search itself (embeddings run on this computer's CPU). The memory conflict
check and Kdenlive/MCP routing keep using the local model, so remote credentials are never
attached to them.

## Preset an endpoint when installing

An installer, or you, can preset an endpoint in the backend's `.env` file:
`~/.local/share/arynwood-mcp/.env` on Linux, `%LOCALAPPDATA%\arynwood-mcp\.env` on Windows, or
the repository root in a source checkout. Make the file readable only by you
(`chmod 600`), because it holds the key.

```bash
ARYNWOOD_ENDPOINT_URL=https://api.example.com/v1
ARYNWOOD_ENDPOINT_TYPE=openai-compatible      # or ollama
ARYNWOOD_ENDPOINT_TOKEN=...                   # the server's API key, if it needs one
ARYNWOOD_ENDPOINT_MODEL=...                   # chat model on that server
ARYNWOOD_ENDPOINT_IMAGE_MODEL=...             # optional: also use it for Design Center
ARYNWOOD_ENDPOINT_NAME=My endpoint            # optional: the name on the Servers page
ARYNWOOD_CPU_MODE=auto                        # auto (default), on or off
```

On its first start with these set, Arynwood registers the server and makes it chat's default
(and the image source, when an image model is given). After that your own choices on the
Servers page stand; a later start only refreshes the token, type and models.

## FAQ

**Can a local AI app use a GPU on another computer?**
Yes. Run Ollama on the computer with the GPU, reach it over a private network or an SSH
tunnel, and add it on Arynwood's Servers page. Chat runs there; your files, memories and
knowledge base stay on the computer running Arynwood.

**Can Arynwood MCP run on a computer or server without a GPU?**
Yes. Chat, knowledge base search, memory and the design canvas run on the CPU, slowly with
larger models. CPU mode switches off the tools that need an NVIDIA GPU, and an endpoint can
take over chat and image generation.

**Does an endpoint see my conversations?**
Yes: a chat endpoint receives each message with its history and the context Arynwood adds,
such as memories and knowledge excerpts. An image endpoint receives prompts and base images.
Your database, files and knowledge base are not uploaded.
