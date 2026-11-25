import { Link } from "react-router-dom";
import { Empty } from "../components/ui";

export default function NotFound() {
  return (
    <section>
      <div className="head">
        <div>
          <h1>Lost on the bridge</h1>
          <p className="sub">This page doesn't exist. Maybe it fell in the river.</p>
        </div>
      </div>
      <Empty title="404" text="Head back to the team picker.">
        <Link className="btn pri" to="/">
          Go to Teams
        </Link>
      </Empty>
    </section>
  );
}
