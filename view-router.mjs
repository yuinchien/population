export function createViewRouter({
  lifecycles,
  setBaseView,
  closeMenu = () => {},
}) {
  const byName = new Map(
    lifecycles.map((lifecycle) => [lifecycle.name, lifecycle]),
  );

  function activate(mode, options) {
    closeMenu();
    for (const lifecycle of lifecycles) {
      if (lifecycle.name !== mode) lifecycle.deactivate();
    }
    const target = byName.get(mode);
    if (target) target.activate(options);
    else setBaseView(mode);
  }

  function bind(container) {
    container.querySelectorAll("button[data-mode]").forEach((button) => {
      button.addEventListener("click", () => activate(button.dataset.mode));
    });
  }

  return { activate, bind };
}
