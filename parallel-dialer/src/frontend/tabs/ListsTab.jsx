/**
 * Lists tab — every CSV import, as a named batch you can hand to a campaign.
 * Contacts are the flat table across all of them; a list is the unit you
 * actually dial.
 */
export default function ListsTab({ lists, onStartCampaign, onDelete }) {
  return (
    <div className="tab tab--lists">
      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Lists</h2>
        </div>

        {lists.length === 0 ? (
          <p className="empty-state">
            Nothing imported yet. Bring in a CSV on the <strong>Contacts</strong> tab — every import becomes a list here.
          </p>
        ) : (
          <div className="sheet">
            <table className="sheet__table sheet__table--lists">
              <thead>
                <tr>
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
                    <td>{list.name}</td>
                    <td className="mono">{list.count}</td>
                    <td className="mono">{list.dialableCount}</td>
                    <td className="mono">{new Date(list.importedAt).toLocaleString()}</td>
                    <td>
                      <div className="row row--end">
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => onStartCampaign(list)}
                          disabled={list.dialableCount === 0}
                        >
                          Start campaign
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
          </div>
        )}
      </section>
    </div>
  );
}
