import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const context = root.replaceAll("\\", "/");
const dockerfile = `${context}sandbox/sound/Dockerfile`;

let command;
let args;
if (process.platform === "win32") {
  const toWsl = (path) =>
    path.replace(/^([A-Za-z]):\//, (_, drive) => `/mnt/${drive.toLowerCase()}/`);
  command = "wsl";
  args = [
    "-d",
    process.env.MIUZIKA_WSL_DISTRO ?? "Ubuntu",
    "--",
    "docker",
    "build",
    "-f",
    toWsl(dockerfile),
    "-t",
    "miuzika-sound-sandbox",
    toWsl(context),
  ];
} else {
  command = "docker";
  args = ["build", "-f", dockerfile, "-t", "miuzika-sound-sandbox", context];
}

const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(`No se pudo construir el sandbox: ${error.message}`);
  process.exit(1);
});
