/**
 * Lists tab — every CSV import, as a named batch you can hand to a campaign.
 * Contacts are the flat table across all of them; a list is the unit you
 * actually dial.
 */
export default function ListsTab({ lists, selectedIds, onSelectionChange, dialableCounts, onStartCampaign, onDelete, compact = false }) {
  const eligible = lists.filter((list) => (dialableCounts.get(list.id) ?? 0) > 0);
  const selected = selectedIds.filter((id) => eligible.some((list) => list.id === id));
  const allSelected = eligible.length > 0 && selected.length === eligible.length;
  return (
    <div className={`tab tab--lists ${compact ? 'tab--lists-compact' : ''}`}>
      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Lists</h2>
          <button type="button" className="btn btn--primary" disabled={!selected.length} onClick={() => onStartCampaign(selected)}>
            Load selected ({selected.length})
          </button>
        </div>

        {lists.length === 0 ? (
          <p className="empty-state">
            Nothing imported yet. Bring in a CSV on the <strong>Contacts</strong> tab — every import becomes a list here.
          </p>
        ) : (
          <>
          <label className="list-select-all"><input type="checkbox" checked={allSelected} disabled={!eligible.length}
            onChange={(event) => onSelectionChange(event.target.checked ? eligible.map((list) => list.id) : [])} />
            Select all dialable lists</label>
          {compact ? <div className="list-cards">{lists.map((list) => <div className="list-card" key={list.id}>
            <label><input type="checkbox" aria-label={`Select ${list.name}`} checked={selected.includes(list.id)}
              disabled={!(dialableCounts.get(list.id) ?? 0)} onChange={(event) => onSelectionChange(event.target.checked
                ? [...selected, list.id] : selected.filter((id) => id !== list.id))} /> {list.name}</label>
            <small>{dialableCounts.get(list.id) ?? 0} dialable · {list.count} contacts</small>
            <button type="button" className="btn" disabled={!(dialableCounts.get(list.id) ?? 0)} onClick={() => onStartCampaign([list.id])}>Load list</button>
          </div>)}</div> : <div className="sheet">
            <table className="sheet__table sheet__table--lists">
              <thead>
                <tr>
                  <th scope="col">Select</th>
                  <th>List</th>
                  <th>Contacts</th>
                  <th>With a cell number</th>
                  <th>Imported</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {lists.map((list) => (
                  <tr key={list.id}>
                    <td><input type="checkbox" aria-label={`Select ${list.name}`} checked={selected.includes(list.id)}
                      disabled={!(dialableCounts.get(list.id) ?? 0)}
                      onChange={(event) => onSelectionChange(event.target.checked
                        ? [...selected, list.id] : selected.filter((id) => id !== list.id))} /></td>
                    <td>{list.name}</td>
                    <td className="mono">{list.count}</td>
                    <td className="mono">{dialableCounts.get(list.id) ?? 0}</td>
                    <td className="mono">{new Date(list.importedAt).toLocaleString()}</td>
                    <td>
                      <div className="row row--end">
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => onStartCampaign([list.id])}
                          disabled={!(dialableCounts.get(list.id) ?? 0)}
                        >
                          Load list
                        </button>
                        <button type="button" className="btn btn--ghost" onClick={() => onDelete(list.id)}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
          {lists.some((list) => !(dialableCounts.get(list.id) ?? 0)) && <p className="import__hint">
            A list with 0 dialable numbers cannot be loaded. Reimport the original CSV with its phone column mapped; existing contacts are not deleted automatically.
          </p>}
          <p className="import__hint">Loading combines unique numbers into one session. It does not start calling; review consent and recipient-local time before pressing Start dialing.</p>
          </>
        )}
      </section>
    </div>
  );
}
