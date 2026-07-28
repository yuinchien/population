export function createViewLifecycle({
  name,
  isActive,
  setActiveState,
  setVisible,
  onEnter = () => {},
  onExit = () => {},
  onVisibilityChange = () => {},
  sync = () => {},
}) {
  function setActive(active, options) {
    if (active === isActive()) return false;
    setActiveState(active);
    setVisible(active);
    onVisibilityChange(active);
    if (active) onEnter(options);
    else onExit(options);
    sync();
    return true;
  }

  return {
    name,
    isActive,
    setActive,
    activate: (options) => setActive(true, options),
    deactivate: (options) => setActive(false, options),
  };
}
