import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { text } from "node:stream/consumers";

export async function readSecretValue(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return (await text(process.stdin)).replace(/\r?\n$/, "");
  }

  process.stderr.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          finish();
          return resolve(value);
        }
        if (char === "\u0003") {
          finish();
          process.exit(130);
        }
        value = char === "\u007f" ? value.slice(0, -1) : value + char;
      }
    };
    const finish = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
    };
    process.stdin.on("data", onData);
  });
}

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  const readline = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await readline.question(`${question} [y/N] `);
  readline.close();
  return answer.trim().toLowerCase() === "y";
}

type Key = { name?: string; ctrl?: boolean };

export async function checklist(title: string, items: string[], checked: Iterable<string>): Promise<string[] | null> {
  const initial = new Set(checked);
  const picked = await menu(title, items, true, items.flatMap((item, index) => (initial.has(item) ? [index] : [])));
  return picked && picked.map((index) => items[index]!);
}

export async function select(title: string, labels: string[]): Promise<number | null> {
  const picked = await menu(title, labels, false, []);
  return picked ? picked[0]! : null;
}

async function menu(title: string, items: string[], multiple: boolean, checked: number[]): Promise<number[] | null> {
  const input = process.stdin;
  const output = process.stderr;
  const selected = new Set(checked);
  const height = Math.min(items.length, Math.max(5, (output.rows ?? 24) - 3));
  let cursor = 0;
  let top = 0;
  let drawn = 0;

  const render = () => {
    top = Math.min(Math.max(top, cursor - height + 1), cursor);
    const rows = items.slice(top, top + height).map((item, offset) => {
      const index = top + offset;
      const box = multiple ? (selected.has(index) ? "[x] " : "[ ] ") : "";
      const line = `${index === cursor ? "\u203a" : " "} ${box}${item}`;
      return index === cursor ? `\x1b[1m${line}\x1b[22m` : line;
    });
    const keys = multiple
      ? `${selected.size} of ${items.length} selected \u00b7 space select \u00b7 a all \u00b7 enter confirm \u00b7 esc cancel`
      : "\u2191\u2193 move \u00b7 enter choose \u00b7 esc cancel";
    const lines = [title, ...rows, `\x1b[2m${keys}\x1b[22m`];
    output.write((drawn > 0 ? `\x1b[${drawn}A` : "") + lines.map((line) => `\x1b[2K${line}\n`).join(""));
    drawn = lines.length;
  };

  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write("\x1b[?25l");

  return new Promise((resolve) => {
    const finish = (result: number[] | null) => {
      input.off("keypress", onKey);
      input.setRawMode(false);
      input.pause();
      output.write("\x1b[?25h");
      resolve(result);
    };
    const onKey = (_text: string, key: Key = {}) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape" || key.name === "q") return finish(null);
      if (key.name === "return") return finish(multiple ? [...selected].sort((a, b) => a - b) : [cursor]);
      if (key.name === "up" || key.name === "k") cursor = (cursor - 1 + items.length) % items.length;
      if (key.name === "down" || key.name === "j") cursor = (cursor + 1) % items.length;
      if (multiple && key.name === "space") {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
      }
      if (multiple && key.name === "a") {
        const all = selected.size === items.length;
        selected.clear();
        if (!all) items.forEach((_item, index) => selected.add(index));
      }
      render();
    };
    input.on("keypress", onKey);
    render();
  });
}
