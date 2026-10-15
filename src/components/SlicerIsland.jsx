import React from 'react';
import StlViewer from './StlViewer.jsx';

/**
 * src/components/SlicerIsland.jsx
 *
 * Thin error boundary wrapper around the client-only Slicer Cockpit.
 *
 * Why: the cockpit is a single large `client:only="react"` island. Before this
 * boundary, any uncaught error thrown while *rendering* (e.g. a telemetry field
 * that was never set) caused React 19 to unmount the entire island root — the
 * whole "3D SLICER ARENA" section silently vanished with no recovery path.
 * The boundary converts any such crash into a visible, dismissible fallback so
 * the rest of the page (and a reload button) always stays usable.
 */
class ViewerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unexpected rendering error' };
  }

  componentDidCatch(error, info) {
    // Keep the full stack in the console for debugging.
    console.error('[SlicerIsland] Slicer cockpit crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="panel-ind-deep cut-sm p-6 my-4 border border-rose-500/40 bg-rose-950/30 text-center">
          <div className="telemetry text-xs text-rose-300 mb-2">3D Slicer Cockpit Recovery</div>
          <p className="text-sm text-zinc-300 mb-1">
            The interactive 3D cockpit hit an unexpected error and was safely paused.
          </p>
          <p className="text-[11px] font-mono text-rose-200/80 mb-4 break-words">{this.state.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-mech btn-primary cut-sm px-4 py-2 text-xs font-bold"
          >
            ↻ Reload 3D Slicer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function SlicerIsland() {
  return (
    <ViewerErrorBoundary>
      <StlViewer />
    </ViewerErrorBoundary>
  );
}
