import { signOut } from '@/app/actions/login';

export function LogoutButton() {
  return (
    <form action={signOut}>
      <button type="submit">Uitloggen</button>
    </form>
  );
}
