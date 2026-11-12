# Chat Change Review

A [Paseo](https://paseo.sh) plugin for reviewing the files an agent changed in a chat and sending line comments back to it. See [OVERVIEW.md](OVERVIEW.md) for what it does and what it stores.

## Development

Requirements: Node.js 22 or later and a Paseo daemon at version 0.15.4 or later.

```bash
npm install
npm run typecheck
```

Install the local checkout on your daemon, then reload it after each change:

```bash
paseo plugin install /absolute/path/to/chat-change-review
paseo plugin reload chat-change-review
paseo plugin logs chat-change-review
```

## Layout

- `index.client.tsx`, `client/`: panels, diff view, comments, translations (English and Korean)
- `index.server.ts`, `server/`: turn snapshots, history, comment storage
- `shared/`: RPC contracts and the message format

## License

MIT. Parts of the syntax highlighter are adapted from Turn Review; see [LICENSE](LICENSE).
