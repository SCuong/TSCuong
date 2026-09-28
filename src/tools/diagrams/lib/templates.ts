export interface DiagramTemplate {
  id: string;
  name: string;
  /** Short explanation shown in the template picker. */
  description: string;
  code: string;
}

/** Starter diagrams for every diagram type the bundled Mermaid version supports and we offer. */
export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  {
    id: 'flowchart',
    name: 'Flowchart',
    description: 'Boxes and arrows for processes and decisions.',
    code: `flowchart TD
    start([User opens LocalKit]) --> pick{Pick a tool}
    pick -->|PDF| pdf[Merge, split, compress]
    pick -->|Images| img[Resize and convert]
    pick -->|Notes| notes[Write Markdown]
    pdf --> done([Everything stays on this device])
    img --> done
    notes --> done`,
  },
  {
    id: 'sequence',
    name: 'Sequence',
    description: 'Messages exchanged between participants over time.',
    code: `sequenceDiagram
    autonumber
    actor User
    participant App as Web app
    participant API
    participant DB as Database
    User->>App: Submit sign-in form
    App->>API: POST /session
    API->>DB: Look up account
    DB-->>API: Account record
    alt Password matches
        API-->>App: 200 OK + session cookie
        App-->>User: Show dashboard
    else Wrong password
        API-->>App: 401 Unauthorized
        App-->>User: Show error message
    end`,
  },
  {
    id: 'class',
    name: 'Class',
    description: 'Classes, their members and relationships.',
    code: `classDiagram
    class Shape {
        <<abstract>>
        +String name
        +area() double
    }
    class Circle {
        +double radius
        +area() double
    }
    class Rectangle {
        +double width
        +double height
        +area() double
    }
    class Canvas {
        -List~Shape~ shapes
        +add(Shape s) void
        +render() void
    }
    Shape <|-- Circle
    Shape <|-- Rectangle
    Canvas "1" o-- "*" Shape : contains`,
  },
  {
    id: 'state',
    name: 'State',
    description: 'States of a system and the transitions between them.',
    code: `stateDiagram-v2
    [*] --> Draft
    Draft --> InReview : submit
    InReview --> Draft : request changes
    InReview --> Approved : approve
    Approved --> Published : publish
    Published --> Archived : archive
    Archived --> [*]
    state InReview {
        [*] --> Waiting
        Waiting --> Reviewing : reviewer assigned
        Reviewing --> [*]
    }`,
  },
  {
    id: 'er',
    name: 'Entity relationship',
    description: 'Database tables and how they relate.',
    code: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "ordered in"
    CUSTOMER {
        int id PK
        string name
        string email UK
    }
    ORDER {
        int id PK
        int customer_id FK
        date created_at
        string status
    }
    LINE_ITEM {
        int order_id FK
        int product_id FK
        int quantity
    }
    PRODUCT {
        int id PK
        string title
        decimal price
    }`,
  },
  {
    id: 'gantt',
    name: 'Gantt',
    description: 'Project schedule with tasks, dependencies and milestones.',
    code: `gantt
    title Website relaunch
    dateFormat YYYY-MM-DD
    axisFormat %b %d
    section Design
        Research           :done,    res, 2026-03-02, 5d
        Wireframes         :done,    wf,  after res, 6d
        Visual design      :active,  vd,  after wf, 8d
    section Build
        Frontend           :         fe,  after vd, 12d
        Content migration  :         cm,  after wf, 10d
    section Launch
        QA and fixes       :         qa,  after fe, 5d
        Go live            :milestone, m1, after qa, 0d`,
  },
  {
    id: 'journey',
    name: 'User journey',
    description: 'Steps a user takes and how they feel at each one.',
    code: `journey
    title Ordering coffee with a mobile app
    section Discover
      Open the app: 4: Customer
      Browse the menu: 3: Customer
    section Order
      Customize drink: 4: Customer
      Pay: 2: Customer, Payment provider
    section Pick up
      Wait for notification: 3: Customer
      Collect order: 5: Customer, Barista`,
  },
  {
    id: 'mindmap',
    name: 'Mindmap',
    description: 'Ideas branching out from a central topic.',
    code: `mindmap
  root((Launch plan))
    Product
      Feature freeze
      Release notes
    Marketing
      Blog post
      Newsletter
      Social media
    Support
      Update docs
      Train the team`,
  },
  {
    id: 'timeline',
    name: 'Timeline',
    description: 'Events grouped by period.',
    code: `timeline
    title History of the web
    1991 : First website goes online
    1995 : JavaScript is created
         : First CSS proposal published
    2008 : HTML5 first public draft
    2015 : ES2015 modernizes JavaScript
    2017 : WebAssembly ships in all major browsers`,
  },
  {
    id: 'pie',
    name: 'Pie chart',
    description: 'Proportions of a whole.',
    code: `pie showData
    title Where the week goes
    "Deep work" : 18
    "Meetings" : 9
    "Email and chat" : 7
    "Code review" : 5
    "Planning" : 3`,
  },
  {
    id: 'gitgraph',
    name: 'Git graph',
    description: 'Branches, commits and merges.',
    code: `gitGraph
    commit id: "init"
    commit id: "setup CI"
    branch feature/search
    checkout feature/search
    commit id: "add index"
    commit id: "fuzzy match"
    checkout main
    commit id: "hotfix"
    merge feature/search tag: "v1.1.0"
    commit id: "release notes"`,
  },
];

export const DEFAULT_TEMPLATE = DIAGRAM_TEMPLATES[0];

export function getTemplate(id: string | undefined): DiagramTemplate | undefined {
  return DIAGRAM_TEMPLATES.find((t) => t.id === id);
}

const TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/^(flowchart|graph)\b/, 'flowchart'],
  [/^sequenceDiagram\b/, 'sequence'],
  [/^classDiagram(-v2)?\b/, 'class'],
  [/^stateDiagram(-v2)?\b/, 'state'],
  [/^erDiagram\b/, 'er'],
  [/^gantt\b/, 'gantt'],
  [/^journey\b/, 'journey'],
  [/^mindmap\b/, 'mindmap'],
  [/^timeline\b/, 'timeline'],
  [/^pie\b/, 'pie'],
  [/^gitGraph\b/, 'gitgraph'],
];

/**
 * Detects which template family a diagram belongs to from its first meaningful
 * line (skipping front matter, `%%` comments and blank lines).
 */
export function detectDiagramKind(code: string): string | null {
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++;
  }
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('%%')) continue;
    for (const [pattern, kind] of TYPE_PATTERNS) if (pattern.test(line)) return kind;
    return null;
  }
  return null;
}
