import "./App.css";

const workflowColumns = ["Pending", "Started", "Blocked", "Review", "Complete"];

export function App() {
  return (
    <main className="app-root">
      <section
        className="board-shell"
        data-testid="board-shell"
        data-theme="industrial-dark"
        aria-label="Task workflow board"
      >
        <header className="board-header">
          <h1>Taskboard</h1>
          <p>Desktop workflow shell</p>
        </header>

        <div className="workflow-grid" role="list" aria-label="Workflow columns">
          {workflowColumns.map((column) => (
            <article className="workflow-column" role="listitem" key={column}>
              <h2>{column}</h2>
              <div className="column-body" aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
