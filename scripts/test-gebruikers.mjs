// Tests voor lib/auth/gebruikers-kern.ts (gebruikersbeheer): node --experimental-strip-types scripts/test-gebruikers.mjs
import assert from "node:assert/strict";
const k = await import("../lib/auth/gebruikers-kern.ts");

let n = 0;
const test = (naam, fn) => { fn(); n++; console.log(`  ✓ ${naam}`); };

test("nieuwe gebruiker: geldig, initialen automatisch, e-mail klein", () => {
  const r = k.valideerNieuweGebruiker({ naam: "  Bram  Huiskes ", email: "Bram@Studio-Levant.nl ", rol: "gebruiker", boekhouding: true, wachtwoord: "abcd-efgh-jkmn-pqrs" });
  assert.ok(r.ok);
  assert.equal(r.waarde.naam, "Bram Huiskes");
  assert.equal(r.waarde.email, "bram@studio-levant.nl");
  assert.equal(r.waarde.initialen, "BH");
  assert.equal(r.waarde.boekhouding, true);
});
test("nieuwe gebruiker: kort wachtwoord, geen rol, slecht e-mailadres", () => {
  assert.equal(k.valideerNieuweGebruiker({ naam: "A", email: "a@b.nl", rol: "gebruiker", wachtwoord: "kort" }).ok, false);
  assert.equal(k.valideerNieuweGebruiker({ naam: "A", email: "a@b.nl", wachtwoord: "lang-genoeg-123" }).ok, false);
  assert.equal(k.valideerNieuweGebruiker({ naam: "A", email: "geen-mail", rol: "admin", wachtwoord: "lang-genoeg-123" }).ok, false);
});
test("admin krijgt altijd boekhouding; vinkje ontbreekt = geen boekhouding", () => {
  const a = k.valideerNieuweGebruiker({ naam: "A", email: "a@b.nl", rol: "admin", boekhouding: false, wachtwoord: "lang-genoeg-123" });
  assert.ok(a.ok && a.waarde.boekhouding === true);
  const g = k.valideerNieuweGebruiker({ naam: "A", email: "a@b.nl", rol: "gebruiker", wachtwoord: "lang-genoeg-123" });
  assert.ok(g.ok && g.waarde.boekhouding === false);
});
test("wijziging: leeg geweigerd, leeg wachtwoord genegeerd, admin → boekhouding", () => {
  assert.equal(k.valideerWijziging({}).ok, false);
  assert.equal(k.valideerWijziging({ wachtwoord: "" }).ok, false);
  const w = k.valideerWijziging({ rol: "admin", boekhouding: false });
  assert.ok(w.ok && w.waarde.boekhouding === true);
  assert.equal(k.valideerWijziging({ actief: "nee" }).ok, false);
});
const leden = [
  { userId: "d", rol: "admin", actief: true },
  { userId: "b", rol: "gebruiker", actief: true }
];
test("beheer: jezelf niet verwijderen/deactiveren/degraderen", () => {
  assert.match(k.beheerFout({ doelId: "d", zelfId: "d", leden }, null), /eigen account/);
  assert.match(k.beheerFout({ doelId: "d", zelfId: "d", leden }, { actief: false }), /eigen account/);
  assert.match(k.beheerFout({ doelId: "d", zelfId: "d", leden }, { rol: "gebruiker" }), /admin-rol/);
  assert.equal(k.beheerFout({ doelId: "d", zelfId: "d", leden }, { naam: "Daniel" }), null);
});
test("beheer: anderen wel, maar altijd één actieve admin", () => {
  assert.equal(k.beheerFout({ doelId: "b", zelfId: "d", leden }, null), null);
  assert.equal(k.beheerFout({ doelId: "b", zelfId: "d", leden }, { actief: false }), null);
  const tweeAdmins = [...leden, { userId: "x", rol: "admin", actief: true }];
  assert.equal(k.beheerFout({ doelId: "x", zelfId: "d", leden: tweeAdmins }, null), null);
  assert.match(k.beheerFout({ doelId: "q", zelfId: "d", leden }, null), /bestaat niet/);
  // Laatste actieve admin door een andere (inactieve) admin heen afnemen kan niet.
  const alleenX = [{ userId: "d", rol: "admin", actief: false }, { userId: "x", rol: "admin", actief: true }];
  assert.match(k.beheerFout({ doelId: "x", zelfId: "d", leden: alleenX }, { rol: "gebruiker" }), /minstens één actieve admin/);
});
console.log(`\n${n} tests geslaagd.`);
