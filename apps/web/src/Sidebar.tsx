import {
  BookOpenText,
  CircleHelp,
  GitFork,
  PanelLeft,
  Plus,
  Settings,
} from 'lucide-react';

export interface SidebarProps {
  readonly edgeCount: number;
  readonly nodeCount: number;
}

export function Sidebar({ edgeCount, nodeCount }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="sidebar__brand" aria-label="LLM Graph Workbench">
        <span className="sidebar__mark" aria-hidden="true">
          <GitFork size={19} />
        </span>
        <span>
          <strong>Workbench</strong>
          <small>Graph conversations</small>
        </span>
      </div>

      <button
        className="sidebar__new"
        type="button"
        disabled
        title="Graph creation coming soon"
      >
        <Plus size={16} aria-hidden="true" /> New graph
      </button>

      <nav aria-label="Your graphs">
        <span className="sidebar__label">Recent</span>
        <button
          className="graph-list-item is-active"
          type="button"
          aria-current="page"
        >
          <span className="graph-list-item__icon" aria-hidden="true">
            <BookOpenText size={16} />
          </span>
          <span>
            <strong>Oxidative phosphorylation</strong>
            <small>
              {nodeCount} nodes · {edgeCount} edges
            </small>
          </span>
        </button>
      </nav>

      <div className="edge-legend" aria-label="Graph edge legend">
        <span className="sidebar__label">Edge language</span>
        <div>
          <i className="edge-key edge-key--context" /> Context
        </div>
        <div>
          <i className="edge-key edge-key--provenance" /> Provenance
        </div>
        <div>
          <i className="edge-key edge-key--reference" /> Reference
        </div>
      </div>

      <div className="sidebar__footer">
        <button type="button" disabled title="Help center coming soon">
          <CircleHelp aria-hidden="true" size={16} /> Help
        </button>
        <button type="button" disabled title="Settings coming soon">
          <Settings aria-hidden="true" size={16} /> Settings
        </button>
        <button
          className="sidebar__collapse"
          type="button"
          disabled
          title="Collapse coming soon"
        >
          <PanelLeft aria-hidden="true" size={16} />
          <span className="sr-only">Collapse sidebar</span>
        </button>
      </div>
    </aside>
  );
}
