import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const context = `${root}sandbox/sound`.replaceAll("\\", "/");

let command;
let args;
if (process.platform === "win32") {
  const wslPath = context.replace(/^([A-Za-z]):\//, (_, drive) => `/mnt/${drive.toLowerCase()}/`);
  command = "wsl";
  args = [
    "-d",
    process.env.MIUZIKA_WSL_DISTRO ?? "Ubuntu",
    "--",
    "docker",
    "build",
    "-t",
    "miuzika-sound-sandbox",
    wslPath,
  ];
} else {
  command = "docker";
  args = ["build", "-t", "miuzika-sound-sandbox", context];
}

const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(`No se pudo construir el sandbox: ${error.message}`);
  process.exit(1);
});
