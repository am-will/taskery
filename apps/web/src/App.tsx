import "./App.css";
import { useState } from "react";

const workflowColumns = ["Pending", "Started", "Blocked", "Review", "Complete"];
const defaultTaskDraft = {
  title: "",
  priority: "Medium",
  dueDate: "",
  assignee: "",
  notes: "",
};

export function App() {
  const [taskDraft, setTaskDraft] = useState(defaultTaskDraft);

  const updateTaskDraft = (field: keyof typeof defaultTaskDraft, value: string) => {
    setTaskDraft((current) => ({ ...current, [field]: value }));
  };

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

        <section className="editor-panel" aria-label="Task editor">
          <div className="editor-panel-header">
            <h2>Task Editor</h2>
            <button
              type="button"
              className="new-task-button"
              onClick={() => setTaskDraft(defaultTaskDraft)}
            >
              New Task
            </button>
          </div>

          <form className="task-form" aria-label="Create or edit task">
            <label htmlFor="task-title">
              Title
              <input
                id="task-title"
                name="title"
                value={taskDraft.title}
                onChange={(event) => updateTaskDraft("title", event.target.value)}
                type="text"
              />
            </label>

            <label htmlFor="task-priority">
              Priority
              <select
                id="task-priority"
                name="priority"
                value={taskDraft.priority}
                onChange={(event) => updateTaskDraft("priority", event.target.value)}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </label>

            <label htmlFor="task-due-date">
              Due Date
              <input
                id="task-due-date"
                name="dueDate"
                value={taskDraft.dueDate}
                onChange={(event) => updateTaskDraft("dueDate", event.target.value)}
                type="date"
              />
            </label>

            <label htmlFor="task-assignee">
              Assignee
              <input
                id="task-assignee"
                name="assignee"
                value={taskDraft.assignee}
                onChange={(event) => updateTaskDraft("assignee", event.target.value)}
                type="text"
              />
            </label>

            <label htmlFor="task-notes">
              Notes
              <textarea
                id="task-notes"
                name="notes"
                value={taskDraft.notes}
                onChange={(event) => updateTaskDraft("notes", event.target.value)}
              />
            </label>
          </form>
        </section>

        <section className="workflow-grid" role="list" aria-label="Workflow columns">
          {workflowColumns.map((column) => (
            <article className="workflow-column" role="listitem" key={column}>
              <h2>{column}</h2>
              <div className="column-body" aria-hidden="true" />
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
