/** Loading is not dialing. Only valid, unique, non-DNC numbers enter a session. */
export function selectCampaignContacts(contacts, selectedIds, callOutcomes, followUpPhones = new Set()) {
  const selected = new Set(selectedIds);
  const blocked = new Set(callOutcomes.filter((entry) => entry.outcome === 'do_not_call').map((entry) => entry.phone));
  const seen = new Set();
  return contacts.filter((contact) => {
    const phone = contact.phone1;
    if (!selected.has(contact.listId) && !(selected.has('follow-ups') && followUpPhones.has(phone))) return false;
    if (!/^\+[1-9]\d{6,14}$/.test(phone) || blocked.has(phone) || /^(do not call|dnc)$/i.test(contact.status?.trim() ?? '') || seen.has(phone)) return false;
    seen.add(phone);
    return true;
  });
}
