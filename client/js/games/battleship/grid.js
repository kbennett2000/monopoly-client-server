/**
 * Battleship — shared 10×10 grid primitive.
 *
 * Builds a CSS-Grid <div> with one cell per (x,y), each cell tagged with
 * data-x / data-y attributes. Used by both the setup and firing phases.
 *
 * Keeping this thin: cell rendering is owned by the phase modules
 * (they paint ships, shots, overlays). This module just provides the
 * grid scaffold + a couple of lookup helpers shared by both phases.
 */

const BattleshipGrid = (() => {
  /**
   * @param {number} width  e.g. 10
   * @param {number} height e.g. 10
   * @param {object} options
   * @param {string} [options.id]              DOM id for the grid container
   * @param {string} [options.className]       extra class appended to .bs-grid
   * @param {Function} [options.onCellMousedown] (event, x, y) => void
   * @returns {HTMLDivElement}
   */
  function build(width, height, options = {}) {
    const grid = document.createElement('div');
    if (options.id) grid.id = options.id;
    grid.className = 'bs-grid' + (options.className ? ` ${options.className}` : '');
    grid.style.gridTemplateColumns = `repeat(${width}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${height}, 1fr)`;
    grid.dataset.width = String(width);
    grid.dataset.height = String(height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = document.createElement('div');
        cell.className = 'bs-cell';
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        if (options.onCellMousedown) {
          cell.addEventListener('mousedown', (e) => options.onCellMousedown(e, x, y));
        }
        grid.appendChild(cell);
      }
    }
    return grid;
  }

  /** Lookup a single cell element by coordinate. */
  function getCell(grid, x, y) {
    return grid.querySelector(`.bs-cell[data-x="${x}"][data-y="${y}"]`);
  }

  /**
   * Resolve which cell of `grid` is under the given viewport point, or null
   * if the cursor is outside the grid. Uses elementFromPoint so it works
   * across overlapping elements (the floating drag ghost, if any).
   */
  function cellFromPoint(grid, clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !el.classList.contains('bs-cell')) return null;
    if (!grid.contains(el)) return null;
    return { x: Number(el.dataset.x), y: Number(el.dataset.y) };
  }

  /** Remove a given class from every cell in the grid. */
  function clearClass(grid, className) {
    grid.querySelectorAll('.' + className).forEach((el) => el.classList.remove(className));
  }

  return { build, getCell, cellFromPoint, clearClass };
})();
