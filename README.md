# miuzika-new

The GUI of miuzika (openDAW timeline, piano roll, playback, export), separated from the agent.

```
npm install
npm run dev        # localhost:5180 (needs Python with numpy, and ffmpeg for the MP3)
npm run typecheck
npm test
```

`web/src/main.ts` only wires the pieces; see its header for the map. `workspace/proyectos/` is outside git.
