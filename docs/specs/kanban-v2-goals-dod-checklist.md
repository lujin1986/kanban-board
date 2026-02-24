# Kanban v2: Goals & DoD/Checklist Specification

**Version:** 2.0
**Date:** 2026-01-30
**Status:** Draft - Awaiting Final Confirmation

---

## 1. Goals

### Primary Goals
1. **Add Board-Level Goals Page** - A dedicated "Goals" page/tab for strategic context
2. **Add Task-Level DoD Checklists** - Enable granular completion tracking with checkable items
3. **Preserve Simplicity** - Keep the lightweight, no-auth architecture

### Pre-Filled Default Goals (for initial setup)
```markdown
## Active Goals

### Proactive Kanban Workflow
- Maintain daily board hygiene
- Move tasks through columns promptly
- Keep backlog prioritized and groomed

### Implement Goals + DoD/Checklist
- Board-level goals for strategic context
- Per-task Definition of Done checklists

### Local-Agent Extractor Usage
- Integrate with local AI agents for task extraction
- Support clawdbot SSE integration
- Enable automated task creation from conversations

### SPU Fact-Sources Review Checklist
- [ ] Verify source authenticity
- [ ] Cross-reference with primary sources
- [ ] Document citation chain
- [ ] Flag uncertainty levels
```

---

## 2. Non-Goals

1. **User Authentication** - No login/auth system
2. **Multi-Board Support** - Single board only
3. **Task Dependencies** - No blocking/depends-on relationships
4. **Checklist Templates** - No reusable DoD templates
5. **Rich Text Editor** - Goals/descriptions remain plain markdown
6. **Audit Trail** - No history/versioning of changes
7. **Permissions** - All users have full edit access
8. **SSE/Real-Time Updates for Goals/Checklists** - Not required for this MVP; existing SSE for task CRUD remains unchanged

---

## 3. Database Schema Changes

### 3.1 New Table: `settings` (Key-Value Store)

```sql
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default goals
INSERT OR IGNORE INTO settings (key, value) VALUES ('goals_markdown', '');
```

**Rationale:** Key-value table allows future extensibility (e.g., board title, theme settings). Goals stored under key `goals_markdown`.

### 3.2 Alter Table: `tasks` - Add checklist column

```sql
ALTER TABLE tasks ADD COLUMN checklist TEXT DEFAULT '[]';
```

**Checklist JSON Schema:**
```json
[
  {
    "id": "uuid-string",
    "text": "Checklist item description",
    "checked": false,
    "created_at": "2026-01-30T12:00:00Z"
  }
]
```

**Rationale:** JSON column keeps checklist items with their parent task. Simple, no joins required.

### 3.3 Migration Script

```javascript
// backend/migrations/001-goals-checklist.js
function migrate(db) {
    // Create settings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Insert default goals (with pre-filled content)
    const defaultGoals = `## Active Goals

### Proactive Kanban Workflow
- Maintain daily board hygiene
- Move tasks through columns promptly
- Keep backlog prioritized and groomed

### Implement Goals + DoD/Checklist
- Board-level goals for strategic context
- Per-task Definition of Done checklists

### Local-Agent Extractor Usage
- Integrate with local AI agents for task extraction
- Support clawdbot SSE integration
- Enable automated task creation from conversations

### SPU Fact-Sources Review Checklist
- [ ] Verify source authenticity
- [ ] Cross-reference with primary sources
- [ ] Document citation chain
- [ ] Flag uncertainty levels`;

    const stmt = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
    stmt.run('goals_markdown', defaultGoals);

    // Add checklist column to tasks (if not exists)
    const columns = db.pragma('table_info(tasks)');
    const hasChecklist = columns.some(col => col.name === 'checklist');
    if (!hasChecklist) {
        db.exec(`ALTER TABLE tasks ADD COLUMN checklist TEXT DEFAULT '[]'`);
    }
}
```

---

## 4. API Specification

### 4.1 Goals Endpoints

#### GET `/api/goals`
Retrieve the board goals.

**Response:** `200 OK`
```json
{
  "key": "goals_markdown",
  "content": "## Active Goals\n\n### Goal 1\n...",
  "updated_at": "2026-01-30T12:00:00Z"
}
```

#### PUT `/api/goals`
Update the board goals.

**Request Body:**
```json
{
  "content": "## Updated Goals\n\n..."
}
```

**Response:** `200 OK`
```json
{
  "key": "goals_markdown",
  "content": "## Updated Goals\n\n...",
  "updated_at": "2026-01-30T12:30:00Z"
}
```

---

### 4.2 Task Checklist Endpoints

#### GET `/api/tasks/:id/checklist`
Get checklist items for a task.

**Response:** `200 OK`
```json
{
  "taskId": 1,
  "checklist": [
    { "id": "abc123", "text": "Write tests", "checked": true, "created_at": "..." },
    { "id": "def456", "text": "Update docs", "checked": false, "created_at": "..." }
  ]
}
```

#### POST `/api/tasks/:id/checklist`
Add a new checklist item.

**Request Body:**
```json
{
  "text": "New checklist item"
}
```

**Response:** `201 Created`
```json
{
  "id": "generated-uuid",
  "text": "New checklist item",
  "checked": false,
  "created_at": "2026-01-30T12:00:00Z"
}
```

#### PATCH `/api/tasks/:id/checklist/:itemId`
Toggle or update a checklist item.

**Request Body:**
```json
{
  "checked": true
}
```
*or*
```json
{
  "text": "Updated text"
}
```

**Response:** `200 OK`
```json
{
  "id": "abc123",
  "text": "Write tests",
  "checked": true,
  "created_at": "..."
}
```

#### DELETE `/api/tasks/:id/checklist/:itemId`
Delete a checklist item.

**Response:** `204 No Content`

---

### 4.3 Existing Task Endpoints (Modified)

#### GET `/api/tasks/:id`
**Change:** Response now includes `checklist` field.

```json
{
  "id": 1,
  "title": "Task title",
  "description": "...",
  "assignee": "Jin",
  "priority": "high",
  "status": "in-progress",
  "checklist": [
    { "id": "abc123", "text": "Write tests", "checked": true, "created_at": "..." }
  ],
  "created_at": "...",
  "updated_at": "...",
  "comments": [...]
}
```

#### GET `/api/tasks`
**Change:** Each task in array now includes `checklist` field.

---

## 5. Frontend Changes

### 5.1 Navigation Bar (New)

**Location:** Top of page, above board/goals content

**Components:**
```html
<nav class="main-nav">
    <a href="#board" class="nav-link active" data-view="board">Board</a>
    <a href="#goals" class="nav-link" data-view="goals">Goals</a>
</nav>
```

**Behavior:**
- Click toggles between Board view and Goals view
- Active state styled distinctly
- URL hash updates for bookmarking (#board, #goals)
- Page loads to correct view based on URL hash

### 5.2 Goals Page (New View)

**Location:** Replaces board content when Goals tab is active

**Components:**
```html
<section id="goals-view" class="goals-view hidden">
    <div class="goals-container">
        <header class="goals-header">
            <h1>Board Goals</h1>
            <button id="edit-goals" class="btn-secondary">Edit</button>
        </header>
        <div id="goals-display" class="goals-display">
            <!-- Rendered markdown content -->
        </div>
        <div id="goals-editor" class="goals-editor hidden">
            <textarea id="goals-textarea" rows="20"></textarea>
            <div class="goals-actions">
                <button id="save-goals" class="btn-primary">Save</button>
                <button id="cancel-goals" class="btn-secondary">Cancel</button>
            </div>
        </div>
    </div>
</section>
```

**Behavior:**
- Display mode shows rendered markdown (or plain text with line breaks)
- Edit button switches to textarea editor
- Save triggers PUT `/api/goals`
- Cancel reverts to display mode without saving
- Goals fetched on page load and when navigating to Goals tab

### 5.3 Board View (Wrapped)

**Change:** Wrap existing board in a view container for tab switching.

```html
<section id="board-view" class="board-view">
    <!-- Existing .board and contents -->
</section>
```

### 5.4 Task Checklist (In Task Modal)

**Location:** Below description field, above comments section

**Components:**
```html
<div id="checklist-section" class="checklist-section hidden">
    <h4>Definition of Done</h4>
    <ul id="checklist-items" class="checklist-items">
        <!-- Dynamically populated -->
    </ul>
    <div class="checklist-add">
        <input type="text" id="new-checklist-item" placeholder="Add checklist item...">
        <button id="add-checklist-item" class="btn-secondary">Add</button>
    </div>
    <div class="checklist-progress">
        <progress id="checklist-progress" value="0" max="0"></progress>
        <span id="checklist-progress-text">0/0 complete</span>
    </div>
</div>
```

**Checklist Item Template:**
```html
<li class="checklist-item" data-id="abc123">
    <input type="checkbox" id="chk-abc123" checked>
    <label for="chk-abc123">Write tests</label>
    <button class="btn-delete-item" data-id="abc123" title="Delete">&times;</button>
</li>
```

**Behavior:**
- Only visible when editing existing task (hidden on create new task)
- Checkbox toggle triggers PATCH `/api/tasks/:id/checklist/:itemId`
- Delete button (×) triggers DELETE `/api/tasks/:id/checklist/:itemId`
- Enter key in input adds new item via POST
- Progress bar updates on any checklist change
- Items ordered by `created_at` ascending

### 5.5 Task Card Badge

**Enhancement:** Show checklist progress on task cards in columns.

```html
<div class="task-card" data-id="1">
    <h3>Task Title</h3>
    <div class="task-meta">
        <span class="assignee">J</span>
        <span class="priority high">High</span>
        <span class="checklist-badge" title="2/5 complete">&#10003; 2/5</span>
    </div>
</div>
```

**Behavior:**
- Badge only shown if task has checklist items
- Format: ✓ X/Y where X=checked, Y=total
- Hidden if checklist is empty

### 5.6 CSS Additions

```css
/* Navigation */
.main-nav {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    background: #f5f5f5;
    border-bottom: 1px solid #ddd;
}
.nav-link {
    padding: 0.5rem 1rem;
    text-decoration: none;
    color: #333;
    border-radius: 4px;
}
.nav-link.active {
    background: #007bff;
    color: white;
}

/* Views */
.board-view, .goals-view { padding: 1rem; }
.hidden { display: none !important; }

/* Goals Page */
.goals-container { max-width: 800px; margin: 0 auto; }
.goals-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.goals-display { white-space: pre-wrap; line-height: 1.6; }
.goals-editor textarea { width: 100%; font-family: monospace; padding: 1rem; }
.goals-actions { margin-top: 1rem; display: flex; gap: 0.5rem; }

/* Checklist */
.checklist-section { margin: 1rem 0; padding: 1rem; background: #f9f9f9; border-radius: 4px; }
.checklist-items { list-style: none; padding: 0; margin: 0.5rem 0; }
.checklist-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; }
.checklist-item input[type="checkbox"] { margin: 0; }
.checklist-item label { flex: 1; cursor: pointer; }
.checklist-item input:checked + label { text-decoration: line-through; opacity: 0.6; }
.btn-delete-item { background: none; border: none; color: #999; cursor: pointer; font-size: 1.2rem; }
.btn-delete-item:hover { color: #d9534f; }
.checklist-add { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.checklist-add input { flex: 1; padding: 0.5rem; }
.checklist-progress { margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
.checklist-progress progress { flex: 1; height: 8px; }

/* Task Card Badge */
.checklist-badge { font-size: 0.75rem; color: #666; margin-left: auto; }
```

---

## 6. Error Handling

### API Error Responses

| Status | Condition | Response Body |
|--------|-----------|---------------|
| 400 | Missing required field | `{ "error": "Text is required" }` |
| 400 | Empty checklist text | `{ "error": "Checklist item text cannot be empty" }` |
| 404 | Task not found | `{ "error": "Task not found" }` |
| 404 | Checklist item not found | `{ "error": "Checklist item not found" }` |
| 500 | Database error | `{ "error": "Internal server error" }` |

### Frontend Error Handling

- Display alert or inline error message on API failures
- Disable Save button while request in flight (prevent double-submit)
- Validate checklist text non-empty before submission (client-side)
- Re-fetch data on error to ensure UI consistency

---

## 7. Smoke Test

### Manual Smoke Test Checklist

#### Navigation
- [ ] Load page - nav bar visible with "Board" and "Goals" tabs
- [ ] Board tab active by default (or per URL hash)
- [ ] Click Goals tab - board hidden, goals page shown
- [ ] Click Board tab - goals hidden, board shown
- [ ] URL hash updates on tab switch (#board, #goals)
- [ ] Direct navigation to #goals loads goals page

#### Goals Page
- [ ] Goals page displays current content (or default if first run)
- [ ] Click Edit - textarea appears with current content
- [ ] Modify and Save - content updates, page shows new content
- [ ] Cancel edit - reverts to display mode without saving
- [ ] Refresh page - saved goals persist

#### Checklist in Task Modal
- [ ] Open existing task - checklist section visible
- [ ] Add item (type text, click Add) - appears in list
- [ ] Add item (type text, press Enter) - appears in list
- [ ] Toggle checkbox - checked state toggles
- [ ] Delete item (click ×) - removed from list
- [ ] Progress bar updates correctly
- [ ] Refresh page - checklist items persist
- [ ] Create new task - checklist section NOT visible

#### Task Card Badge
- [ ] Task with checklist shows badge (✓ X/Y)
- [ ] Task without checklist shows no badge
- [ ] Badge count accurate after toggle/add/delete

---

## 8. Acceptance Criteria

### Goals Feature
- [ ] **AC-G1:** Goals content persists across page reloads (stored in `settings` table)
- [ ] **AC-G2:** Goals editable via textarea with Save/Cancel buttons
- [ ] **AC-G3:** Goals page accessible via top-level navigation tab
- [ ] **AC-G4:** Default goals pre-populated on first run (see Section 1)
- [ ] **AC-G5:** GET /api/goals returns goals from settings table
- [ ] **AC-G6:** PUT /api/goals updates goals in settings table

### Checklist Feature
- [ ] **AC-C1:** Tasks display checklist items with checkboxes in modal
- [ ] **AC-C2:** Users can add new checklist items (non-empty text required)
- [ ] **AC-C3:** Users can toggle checklist items checked/unchecked
- [ ] **AC-C4:** Users can delete checklist items
- [ ] **AC-C5:** Checklist progress shown in task modal (X/Y complete + progress bar)
- [ ] **AC-C6:** Task cards show checklist badge (✓ X/Y) when items exist
- [ ] **AC-C7:** Checklist persists with task (survives page reload)
- [ ] **AC-C8:** Checklist section hidden when creating new task

### API
- [ ] **AC-A1:** GET /api/goals returns current goals
- [ ] **AC-A2:** PUT /api/goals updates goals and returns updated object
- [ ] **AC-A3:** GET /api/tasks/:id includes checklist array
- [ ] **AC-A4:** GET /api/tasks includes checklist array per task
- [ ] **AC-A5:** POST /api/tasks/:id/checklist adds item, returns item with ID
- [ ] **AC-A6:** PATCH /api/tasks/:id/checklist/:itemId updates item
- [ ] **AC-A7:** DELETE /api/tasks/:id/checklist/:itemId removes item

### Non-Functional
- [ ] **AC-N1:** No breaking changes to existing task CRUD operations
- [ ] **AC-N2:** Migration runs automatically on server start
- [ ] **AC-N3:** Empty checklist shown as `[]` not null
- [ ] **AC-N4:** Existing SSE for tasks unchanged (SSE not required for goals/checklists)

---

## 9. Confirmed Decisions

| # | Decision | Confirmed Choice |
|---|----------|------------------|
| 1 | Goals storage | `settings` table with key `goals_markdown` (key-value for extensibility) |
| 2 | Checklist storage | JSON column `checklist` in `tasks` table |
| 3 | Goals UI location | Top-level navigation tab "Goals" (separate page, not panel) |
| 4 | Checklist UI in modal | Below description, above comments |
| 5 | SSE for goals/checklists | NOT required for MVP (non-goal) |

---

## 10. Implementation Order (Suggested)

1. Database migration (settings table + checklist column)
2. Backend API: goals endpoints (GET, PUT)
3. Backend API: checklist endpoints (GET, POST, PATCH, DELETE)
4. Backend: modify GET /api/tasks to include checklist
5. Frontend: add navigation bar with Board/Goals tabs
6. Frontend: implement Goals page (view/edit)
7. Frontend: add checklist section to task modal
8. Frontend: add checklist badge to task cards
9. Smoke testing all features
10. Verify default goals pre-filled

---

**STOP: Awaiting final confirmation before implementation.**

Please confirm this spec is correct and approve to proceed with implementation.
