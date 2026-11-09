import { createStore } from './store.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || '/data';
const DIST_DIR = process.env.DIST_DIR || '/game/dist';
const IMG_DIR = process.env.IMG_DIR || '/game/img';
const SAVE_TOKEN = process.env.SAVE_TOKEN || '';

const store = await createStore(DATA_DIR);
const app = createApp({ store, distDir: DIST_DIR, imgDir: IMG_DIR, token: SAVE_TOKEN });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`dol-kr-mod save server listening on :${PORT} (data=${DATA_DIR}, dist=${DIST_DIR}, img=${IMG_DIR}, auth=${SAVE_TOKEN ? 'token' : 'none'})`);
});
