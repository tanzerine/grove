'use client';
import AutopilotPill from './AutopilotPill';
import { useChrome } from './chrome-context';

/**
 * The autopilot toggle, pinned to the nav bar on every page. Reads the active
 * domain + its autopilot state from ChromeProvider so it stays in sync as the
 * user switches sites.
 */
export default function NavAutopilot() {
  const { activeId, activeAutoPublish } = useChrome();
  if (!activeId) return null;
  return <AutopilotPill domainId={activeId} autoPublish={activeAutoPublish} />;
}
