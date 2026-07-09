document.addEventListener('DOMContentLoaded', function () {
  const body = document.getElementById('regelsBody');
  const toevoegKnop = document.getElementById('regelToevoegen');

  function nieuweRij() {
    const rij = document.createElement('tr');
    rij.className = 'regel-row';
    rij.innerHTML = `
      <td><input type="text" name="regelBeschrijving[]" required></td>
      <td class="mid-col"><input type="text" name="regelMidden[]"></td>
      <td><input type="text" name="regelTotaal[]" required inputmode="decimal"></td>
      <td><button type="button" class="verwijder-regel" title="Regel verwijderen">&times;</button></td>
    `;
    body.appendChild(rij);
  }

  toevoegKnop.addEventListener('click', nieuweRij);

  body.addEventListener('click', function (event) {
    if (event.target.classList.contains('verwijder-regel')) {
      const rijen = body.querySelectorAll('.regel-row');
      if (rijen.length > 1) {
        event.target.closest('tr').remove();
      }
    }
  });
});
