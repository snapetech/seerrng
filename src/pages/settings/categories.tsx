import SettingsCategories from '@app/components/Settings/SettingsCategories';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const SettingsCategoriesPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  return (
    <SettingsLayout>
      <SettingsCategories />
    </SettingsLayout>
  );
};

export default SettingsCategoriesPage;
