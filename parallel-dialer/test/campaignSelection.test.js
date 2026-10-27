import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectCampaignContacts } from '../src/frontend/lib/campaignSelection.js';
import { parseContactsCsv, toE164 } from '../src/frontend/lib/csv.js';

test('two selected lists become one deduplicated, DNC-filtered queue', () => {
  const contacts = [
    { listId: 'a', phone1: '+13055550100' },
    { listId: 'b', phone1: '+13055550100' },
    { listId: 'b', phone1: '+13055550101' },
    { listId: 'b', phone1: '+13055550102', status: 'Do not call' },
    { listId: 'c', phone1: '+13055550103' },
    { listId: 'a', phone1: 'bad number' },
  ];
  const selected = selectCampaignContacts(contacts, ['a', 'b'], [{ phone: '+13055550101', outcome: 'do_not_call' }]);
  assert.deepEqual(selected.map((contact) => contact.phone1), ['+13055550100']);
});

test('a nonstandard CSV phone header can be mapped without guessing the wrong field', () => {
  const csv = 'Company,Reception number,Outbound line\nControlled test,305-555-0100,305-555-0101';
  const automatic = parseContactsCsv(csv);
  assert.equal(automatic.contacts[0].phone1, '');
  const mapped = parseContactsCsv(csv, { phone1Column: 2 });
  assert.equal(toE164(mapped.contacts[0].phone1), '+13055550101');
  assert.deepEqual(mapped.headers, ['Company', 'Reception number', 'Outbound line']);
});
