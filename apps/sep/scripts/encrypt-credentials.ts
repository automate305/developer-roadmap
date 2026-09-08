/**
 * One-off migration: encrypts any mailbox credential still stored in the clear.
 *
 *   npm run encrypt:credentials            # report what would change
 *   npm run encrypt:credentials -- --apply # write the encrypted values
 *
 * Safe to re-run. Values already encrypted are left alone, and each rewrite is
 * verified by decrypting it back before the row is saved.
 */
import { prisma } from '../lib/prisma';
import { encryptSecret, decryptSecret, isEncrypted, secretsMatch } from '../lib/crypto';

async function main() {
  const apply = process.argv.includes('--apply');
  const accounts = await prisma.sendingAccount.findMany();

  let alreadyDone = 0;
  const pending: { id: string; fromEmail: string; fields: string[] }[] = [];

  for (const account of accounts) {
    const fields: string[] = [];
    if (!isEncrypted(account.smtpPassword)) fields.push('smtpPassword');
    if (account.imapPassword && !isEncrypted(account.imapPassword)) fields.push('imapPassword');

    if (fields.length === 0) {
      alreadyDone += 1;
      continue;
    }
    pending.push({ id: account.id, fromEmail: account.fromEmail, fields });
  }

  console.log(`${accounts.length} sending account(s): ${alreadyDone} already encrypted, ${pending.length} to do.`);
  for (const item of pending) {
    console.log(`  ${item.fromEmail} — ${item.fields.join(', ')}`);
  }

  if (pending.length === 0) {
    await prisma.$disconnect();
    return;
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write these changes.');
    await prisma.$disconnect();
    return;
  }

  for (const item of pending) {
    const account = await prisma.sendingAccount.findUniqueOrThrow({ where: { id: item.id } });

    const smtpPassword = isEncrypted(account.smtpPassword)
      ? account.smtpPassword
      : encryptSecret(account.smtpPassword);
    const imapPassword =
      account.imapPassword && !isEncrypted(account.imapPassword)
        ? encryptSecret(account.imapPassword)
        : account.imapPassword;

    // Prove the round trip before committing, so a bad key cannot lock a
    // mailbox out of its own password.
    if (!secretsMatch(decryptSecret(smtpPassword), account.smtpPassword)) {
      throw new Error(`Round-trip check failed for ${account.fromEmail}; nothing was written.`);
    }
    if (imapPassword && account.imapPassword && !secretsMatch(decryptSecret(imapPassword), account.imapPassword)) {
      throw new Error(`IMAP round-trip check failed for ${account.fromEmail}; nothing was written.`);
    }

    await prisma.sendingAccount.update({
      where: { id: account.id },
      data: { smtpPassword, imapPassword },
    });
    console.log(`  encrypted ${account.fromEmail}`);
  }

  console.log('\nDone.');
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
