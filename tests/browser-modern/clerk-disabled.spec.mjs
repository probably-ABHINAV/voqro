import {test, expect} from '@playwright/test';

test('staged Clerk code keeps the existing login available without creating a provider application', async ({page}) => {
  const providerRequests = [], errors = [];
  page.on('request', request => { if (/clerk\.(accounts\.dev|com)|clerk\.browser|clerk-js/.test(request.url())) providerRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/account/clerk');
  await expect(page.getByRole('heading', {name: 'Use your existing sign-in.'})).toBeVisible();
  await page.getByRole('link', {name: 'Sign in to Voqro'}).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Email address', {exact: true})).toBeVisible();
  await expect(page.getByLabel('Password', {exact: true})).toBeVisible();
  expect(providerRequests).toEqual([]);
  expect(errors).toEqual([]);
});
