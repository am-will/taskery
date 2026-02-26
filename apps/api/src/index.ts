export function startApiScaffold(): void {
  process.stdout.write("API scaffold ready.\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startApiScaffold();
}
