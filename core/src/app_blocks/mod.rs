//! A closed, model-free connection hub. Apps propose; only a local person's click executes.
//! Proposals are visit-only. A failed/uncertain write is never automatically retried.
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppBlock { pub query: String, pub when: String }
impl AppBlock {
    pub fn validate(&self) -> Result<()> {
        if self.query.trim().is_empty() || self.query.len() > 160 || self.query.chars().any(char::is_control) { bail!("Enter a reminder title match (1–160 bytes)."); }
        if !crate::apps::valid_date(&self.when) { bail!("Choose a real Calendar date."); }
        Ok(())
    }
}
#[derive(Clone, Serialize)]
pub struct Step { pub name: String, pub state: String, pub detail: String }
#[derive(Clone, Serialize)]
pub struct Plan { pub id: String, pub source: String, pub block: AppBlock, pub steps: Vec<Step>, pub title: Option<String> }
#[derive(Default)]
pub struct Hub { plans: Vec<Plan>, requests: HashMap<String, String> }
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    List,
    Plan { block: AppBlock },
    Confirm { plan_id: String, step: usize },
    Dismiss { plan_id: String },
}
#[derive(Clone, Serialize)]
pub struct Reply { pub request_id: String, pub message: String, pub plans: Vec<Plan>, pub play: bool }
impl Hub {
    pub fn propose(&mut self, block: AppBlock, source: &str) -> Result<String> {
        block.validate()?;
        if self.plans.len() >= 20 { bail!("Dismiss an old plan before adding another."); }
        let id = uuid::Uuid::new_v4().to_string();
        self.plans.push(Plan { id: id.clone(), source: source.into(), block, title: None, steps: [
            ("Read Reminders", "Read the first incomplete matching title from the E2A2O list."),
            ("Add to Calendar", "Add one all-day event to the E2A2O calendar on your chosen date."),
            ("Play tune", "Play a short tune in this browser after the Calendar receipt."),
        ].into_iter().map(|(name, detail)| Step { name: name.into(), state: "proposed".into(), detail: detail.into() }).collect() });
        Ok(id)
    }
    pub fn reply(&self, request_id: &str, message: String, play: bool) -> Reply {
        Reply { request_id: request_id.into(), message, plans: self.plans.clone(), play }
    }
    fn claim(&mut self, id: &str, index: usize) -> Result<Plan> {
        let plan = self.plans.iter_mut().find(|p| p.id == id).ok_or_else(|| anyhow::anyhow!("Plan expired. Refresh to review."))?;
        if index >= plan.steps.len() || plan.steps[index].state != "proposed" { bail!("This step is no longer awaiting confirmation."); }
        if plan.steps[..index].iter().any(|s| s.state != "done") { bail!("Confirm and finish the preceding step first."); }
        plan.steps[index].state = "running".into();
        Ok(plan.clone())
    }
    fn finish(&mut self, id: &str, index: usize, result: Result<String>) -> bool {
        let Some(plan) = self.plans.iter_mut().find(|p| p.id == id) else { return false };
        match result {
            Ok(value) => {
                plan.steps[index].state = "done".into();
                if index == 0 {
                    plan.title = Some(value.clone());
                    plan.steps[0].detail = format!("Read matching reminder: {value}");
                    plan.steps[1].detail = format!("Add “{value}” · {} · all day · E2A2O calendar", plan.block.when);
                } else { plan.steps[index].detail = value; }
                index == 2
            }
            Err(e) => { plan.steps[index].state = "failed".into(); plan.steps[index].detail = e.to_string(); false }
        }
    }
}

pub async fn handle(core: &crate::Core, request_id: &str, request: Request, local: bool, on: bool) -> Reply {
    handle_with(core, request_id, request, local, on, crate::apple::reachable(), |plan, step| async move { execute(&plan, step).await }).await
}
async fn handle_with<F, Fut>(core: &crate::Core, request_id: &str, request: Request, local: bool, on: bool, reachable: bool, run: F) -> Reply
where F: FnOnce(Plan, usize) -> Fut, Fut: std::future::Future<Output = Result<String>> {
    let hub = &core.apps.connections;
    let mut play = false;
    let result: Result<String> = async {
        if !local || !reachable { bail!("App connections needs the local host on a Mac. No account was accessed."); }
        if !on { bail!("Enable App connections in Features first."); }
        if request_id.is_empty() || request_id.len() > 80 || !request_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') { bail!("Invalid request identity."); }
        // Replayed or reused envelopes never execute again, even after an uncertain write.
        {
            let mut h = hub.lock().unwrap();
            if h.requests.contains_key(request_id) { bail!("Request already handled. Refresh to review its result."); }
            if h.requests.len() >= 500 { bail!("Connection request limit reached. Restart the core to begin a new visit."); }
            h.requests.insert(request_id.into(), String::new());
        }
        match request {
            Request::List => Ok("Each step waits for its own confirmation. Plans expire when the core restarts.".into()),
            Request::Plan { block } => { hub.lock().unwrap().propose(block, "You")?; Ok("Three proposals ready. Nothing has run.".into()) }
            Request::Dismiss { plan_id } => {
                let mut h = hub.lock().unwrap();
                if h.plans.iter().any(|p| p.id == plan_id && p.steps.iter().any(|s| s.state == "running")) { bail!("A step is still running."); }
                h.plans.retain(|p| p.id != plan_id);
                Ok("Plan dismissed. Completed external actions remain in their apps.".into())
            }
            Request::Confirm { plan_id, step } => {
                let plan = hub.lock().unwrap().claim(&plan_id, step)?;
                let result = run(plan, step).await;
                play = hub.lock().unwrap().finish(&plan_id, step, result);
                Ok("Step finished. Review its receipt before confirming the next.".into())
            }
        }
    }.await;
    // A remote window never receives the local reminder title, even on refusal.
    if !local { return Reply { request_id: request_id.into(), message: result.unwrap_err().to_string(), plans: vec![], play: false }; }
    hub.lock().unwrap().reply(request_id, result.unwrap_or_else(|e| e.to_string()), play)
}
fn quoted(text: &str) -> String { format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\"")) }
fn script(plan: &Plan, step: usize) -> Result<String> {
    plan.block.validate()?;
    match step {
        0 => Ok(format!("tell application \"Reminders\"\nif not (exists list \"E2A2O\") then return \"\"\nrepeat with r in (reminders of list \"E2A2O\" whose completed is false)\nignoring case\nif (name of r as text) contains {} then return name of r as text\nend ignoring\nend repeat\nreturn \"\"\nend tell", quoted(&plan.block.query))),
        1 => {
            let title = plan.title.as_deref().ok_or_else(|| anyhow::anyhow!("Read a matching reminder first."))?;
            let parts: Vec<&str> = plan.block.when.split('-').collect();
            Ok(format!("set d to current date\nset day of d to 1\nset year of d to {}\nset month of d to {}\nset day of d to {}\nset time of d to 0\ntell application \"Calendar\"\nif not (exists calendar \"E2A2O\") then make new calendar with properties {{name:\"E2A2O\"}}\ntell calendar \"E2A2O\" to make new event with properties {{summary:{}, start date:d, end date:d + 1 * days, allday event:true}}\nend tell", parts[0], parts[1], parts[2], quoted(title)))
        }
        _ => bail!("Unknown external block."),
    }
}
async fn execute(plan: &Plan, step: usize) -> Result<String> {
    if step == 2 { return Ok("Tune confirmed for this browser.".into()); }
    let mut command = tokio::process::Command::new("osascript");
    command.arg("-e").arg(script(plan, step)?).kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(20), command.output()).await
        .map_err(|_| anyhow::anyhow!("No receipt within 20 seconds. Check the target app before starting a new plan; nothing will retry."))?
        .map_err(|_| anyhow::anyhow!("Could not reach the local Mac app. Nothing will retry."))?;
    if !output.status.success() { bail!("The Mac app refused the step. Check Automation permissions and the target app; nothing will retry."); }
    if step == 0 {
        let text = String::from_utf8(output.stdout)?.trim().to_string();
        if text.is_empty() { bail!("No incomplete matching reminder in the E2A2O list. Add one or change the match and create a new plan."); }
        if text.len() > 500 || text.chars().any(char::is_control) { bail!("Matching reminder title is too long or contains control characters."); }
        Ok(text)
    } else { Ok("Calendar accepted the new all-day event in E2A2O.".into()) }
}
#[cfg(test)]
mod tests;
