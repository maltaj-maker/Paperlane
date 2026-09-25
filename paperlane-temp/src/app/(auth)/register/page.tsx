import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/server/auth';
import { RegisterForm } from './RegisterForm';

export const metadata: Metadata = {
  title: 'Create an account',
  description:
    'Create a Paper Lantern Books account to save your wishlist, track orders and hear when a book is back in stock.',
};

export default async function RegisterPage() {
  const user = await getCurrentUser().catch(() => null);
  // Someone already signed in has nothing to do here.
  if (user) redirect('/account');

  return <RegisterForm />;
}
