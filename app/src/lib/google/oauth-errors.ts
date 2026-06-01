/** User-facing hints for Google OAuth error query params (callback → UI). */

export const GOOGLE_OAUTH_ERROR_PARAM = 'google_oauth';

export function googleOAuthErrorMessage(code: string | null): string | null {
  if (!code) return null;

  switch (code) {
    case 'access_denied':
      return (
        'Google отклонил вход (403 access_denied). OAuth-приложение в режиме Testing: ' +
        'добавьте свой Google-аккаунт в Test users в Google Cloud Console ' +
        '(APIs & Services → OAuth consent screen → Test users). ' +
        'Подробнее: docs/plans/BL2-0_SECRETS_SETUP.md § «Ошибка 403».'
      );
    case 'org_internal':
      return (
        'Этот OAuth Client настроен как Internal (только пользователи вашего Google Workspace). ' +
        'Войдите корпоративным аккаунтом или смените тип приложения на External + Test users.'
      );
    default:
      return `Ошибка Google OAuth: ${code}. Повторите вход или проверьте настройки в Google Cloud Console.`;
  }
}
