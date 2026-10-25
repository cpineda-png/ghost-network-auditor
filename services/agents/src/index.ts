import { createApp } from "./app.js";

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.log(`unhandledRejection: ${message}`);
});

process.on("uncaughtException", (error) => {
  console.log(`uncaughtException: ${error.message}`);
});

const port = Number(process.env.PORT ?? 8080);
const app = createApp();
app.listen(port, "0.0.0.0", () => {
  console.log(`agents listening on ${port}`);
});
