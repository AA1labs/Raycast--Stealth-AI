import { SmartAction } from "./components/SmartAction";
import { LaunchProps } from "@raycast/api";

export default function Command(props: LaunchProps) {
  return (
    <SmartAction actionId="action-3" launchContext={props.launchContext} />
  );
}
