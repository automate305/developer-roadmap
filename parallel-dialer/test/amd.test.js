/**
 * Unit tests for the pure AMD classifier. No sockets, no API keys — this is
 * the logic that decides whether a human hears an agent or a dial tone, so it
 * is worth pinning down exactly.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyTranscript, Classification } from '../src/backend/streamHandler.js';

describe('classifyTranscript', () => {
  it('treats short greetings as human', () => {
    for (const greeting of ['Hello?', 'Hi', 'Hey there', 'Yeah', 'Yep', 'This is Dave', 'Good morning']) {
      const { classification } = classifyTranscript(greeting);
      assert.equal(classification, Classification.HUMAN, `expected HUMAN for "${greeting}"`);
    }
  });

  it('detects voicemail greetings', () => {
    const machineSamples = [
      "Hi, you've reached Dave's Air Conditioning",
      'Please leave a message after the tone',
      'The person you are trying to reach is not available',
      'Thank you for calling Brickell Roofing',
      'For sales, press one',
      'Your call has been forwarded to voicemail',
    ];
    for (const sample of machineSamples) {
      const { classification } = classifyTranscript(sample);
      assert.equal(classification, Classification.MACHINE, `expected MACHINE for "${sample}"`);
    }
  });

  it('prefers the machine verdict when a greeting opens a recording', () => {
    // The classic false positive: a voicemail that starts with "Hello".
    const { classification } = classifyTranscript("Hello, you've reached the Miami office");
    assert.equal(classification, Classification.MACHINE);
  });

  it('does not classify a long opener as human', () => {
    const { classification } = classifyTranscript(
      'Hello and welcome to our automated scheduling assistant for service requests',
    );
    assert.notEqual(classification, Classification.HUMAN);
  });

  it('returns no verdict for ambiguous or empty audio', () => {
    for (const sample of ['', '   ', 'uh', 'okay so']) {
      const { classification } = classifyTranscript(sample);
      assert.equal(classification, null, `expected no verdict for "${sample}"`);
    }
  });
});
