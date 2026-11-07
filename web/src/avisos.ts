/**
 * The notices log. In miuzika these messages went to the agent's chat; without a chat they
 * need a home that is not the status bar, which the next action overwrites. An error opens
 * the panel on its own, because a silent failure is worse than a panel in the way.
 */

export type TipoAviso = "info" | "error";

export interface Avisos {
  info(texto: string): void;
  error(texto: string): void;
}

export function crearAvisos(boton: HTMLButtonElement, panel: HTMLElement, alCambiarAlto: () => void): Avisos {
  let cuantos = 0;
  const pintarBoton = (): void => {
    boton.textContent = cuantos > 0 ? `Log (${cuantos})` : "Log";
    boton.classList.toggle("active", !panel.hidden);
  };
  const mostrar = (visible: boolean): void => {
    panel.hidden = !visible;
    pintarBoton();
    alCambiarAlto();
  };
  boton.addEventListener("click", () => mostrar(panel.hidden));

  const add = (tipo: TipoAviso, texto: string): void => {
    const fila = document.createElement("div");
    fila.className = `aviso ${tipo}`;
    const hora = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fila.textContent = `${hora}  ${texto}`;
    panel.append(fila);
    panel.scrollTop = panel.scrollHeight;
    cuantos += 1;
    if (tipo === "error" && panel.hidden) mostrar(true);
    else pintarBoton();
  };
  pintarBoton();
  return { info: (texto) => add("info", texto), error: (texto) => add("error", texto) };
}
