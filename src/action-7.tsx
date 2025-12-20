import { SmartAction } from "./components/SmartAction";
import { LaunchProps } from "@raycast/api";

export default function Command(props: LaunchProps) {
  return (
    <SmartAction actionId="action-7" launchContext={props.launchContext} />
  );
}
