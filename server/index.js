import { createApp } from './app.js';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const app = createApp();

app.listen(port, host, () => {
  console.log(`StockPilot API listening on http://${host}:${port}`);
});
