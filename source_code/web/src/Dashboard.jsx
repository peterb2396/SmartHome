import SettingsPage from "./SettingsPage";

export default function Dashboard({ BASE_URL }) {
  return (
    <div>
      <SettingsPage BASE_URL = {BASE_URL}></SettingsPage>
    </div>
  );
}