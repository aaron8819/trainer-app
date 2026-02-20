# Personal Training System Design: Research & Architecture

## Table of Contents

- [Introduction](#introduction)
- [Research: Existing Systems](#research-existing-systems)
  - [Workout Programming & Tracking Apps](#workout-programming--tracking-apps)
  - [Coach-Athlete Platforms](#coach-athlete-platforms)
  - [Wearable/Health Integrations](#wearablehealth-integrations)
  - [Spreadsheets and Notion Communities](#spreadsheets-and-notion-communities)
  - [Open-Source Training Log Projects](#open-source-training-log-projects)
- [Extracted Design Patterns](#extracted-design-patterns)
  - [Onboarding & Profile Setup](#onboarding--profile-setup)
  - [Workout Generation Approaches](#workout-generation-approaches)
  - [Logging UX Patterns](#logging-ux-patterns)
  - [Progression Logic Patterns](#progression-logic-patterns)
  - [Recovery & Readiness Integration](#recovery--readiness-integration)
  - [Analytics & Progress Tracking](#analytics--progress-tracking)
  - [Notifications & Retention](#notifications--retention)
  - [Privacy & Data Security](#privacy--data-security)
  - [Common Challenges & Pitfalls](#common-challenges--pitfalls)
- [Proposed System Design](#proposed-system-design)
  - [A. System Goals and Non-Goals](#a-system-goals-and-non-goals)
  - [B. Personas and User Journeys](#b-personas-and-user-journeys)
  - [C. Canonical Data Model](#c-canonical-data-model)
  - [D. Workout Generation Engine](#d-workout-generation-engine)
  - [E. Logging Workflow and UX](#e-logging-workflow-and-ux)
  - [F. Analytics and Review Features](#f-analytics-and-review-features)
  - [G. Feature Roadmap](#g-feature-roadmap)
  - [H. Tooling and Implementation](#h-tooling-and-implementation)
- [Sources](#sources)

---

Designing a personal training system requires combining proven fitness programming principles with intuitive software design. This document presents a comprehensive design for a personal training app that can generate personalized workouts, streamline workout logging, analyze progress, and adapt programming over time. We begin with deep research into existing solutions – from popular workout apps to coach-client platforms and even DIY spreadsheets – to identify effective workflows and features. We then extract best-practice patterns and highlight common pitfalls. Finally, we propose an end-to-end system design (sections A–H) detailing the system’s goals, user personas, data models, workout generation engine, logging experience, analytics, roadmap, and implementation considerations. The aim is to create a system that optimizes for user adherence, progressive improvement, and injury prevention while remaining flexible and user-friendly.

---

## Research: Existing Systems

To ground our design in reality, we surveyed a broad range of existing fitness training solutions. These span dedicated workout apps for individuals, platforms used by coaches and athletes, wearable integrations for recovery tracking, community-driven spreadsheets/templates, and open-source projects. For each, we note the target personas, core workflows, data requirements, strengths, weaknesses, and unique features. This research ensures our design leverages what works and avoids known failure points.

### Workout Programming & Tracking Apps

This category includes consumer apps that generate workout routines and/or help users log their training. We examined strength training apps (for bodybuilding/powerlifting), running/cycling apps, CrossFit-focused trackers, and general fitness apps. Below is a comparison of representative apps:

#### Fitbod

General gym-goers (beginner to intermediate) Onboard: Input fitness goal, experience, equipment. Generate: Algorithm suggests a daily workout targeting fresh muscle groups. Do & Log: User performs exercises and logs sets/reps in-app. Adapt: Next workout adapts based on logged performance and muscle recovery. Smart workout generator: Uses a proprietary algorithm to select exercises based on muscle recovery, user goal/level, and equipment. Auto-adjusts sets/reps/weight using estimated 1RM and past data. Tracks muscle fatigue with a “recovery heatmap” so you avoid training sore muscles. Integrates with Apple Health & Strava to account for outside activities. Large exercise library (~800 exercises). Low effort for user – just open the app and go. Can feel “black-box.” Users must trust the algorithm. Some report odd exercise orders (e.g. isolation before compound lifts) or lack of periodization. Requires user input to calibrate (must log accurately and occasionally do max reps tests). Not ideal for very advanced lifters seeking specific programming. Subscription model (monthly/yearly for full access). No ads.

#### JuggernautAI

Serious strength athletes (powerlifters, power-building enthusiasts) Onboard: Extensive setup – user enters goals (e.g. powerlifting meet date), current maxes, “weak points,” and available days. Generate: App creates a periodized program tailored to user (e.g. 14-week powerlifting cycle). Do & Log: During each workout, user logs sets; app adjusts next sets in real-time based on performance and RPE feedback. Adapt: Program auto-updates weekly based on recovery and performance; monthly re-calculates training maxes. Coach-like adaptive program: Emulates a personal coach. Programs are fully personalized (volume, intensity, exercise variations) to hit user’s meet or goal date. Uses auto-regulation – if user is fatigued, it reduces weight/volume; if user is crushing sets, it increases difficulty. Many sets use RPE/RIR targets, letting user adjust weight by feel. User chooses accessory exercises from recommendations (adds choice and preference). Built-in technique videos and warm-ups. Highly effective for strength gains (proven results). High commitment: Workouts are long and intense (90+ min), which can overwhelm casual users. Narrow focus on powerlifting means less emphasis on cardio or aesthetic goals. App is complex due to many inputs and adjustments – initial learning curve. Expensive subscription (acts as a premium coaching product). Premium subscription (~$30/month). No free tier. Aimed at users willing to invest in coaching-quality programming.

#### Jefit

Broad range: from beginners replacing pen-and-paper to intermediate lifters wanting structure. Onboard: Basic profile (maybe goals) or skip. Plan: User can choose a routine from templates (e.g. 5x5 strength, push/pull/legs split) or create their own plan using 1,500+ exercise library. Do & Log: User executes workouts, logging sets in the app (which remembers last used weight/reps for each exercise). Rest timer and workout tracking are built-in. Review: User checks stats like total volume, personal records, and even a muscle group heatmap of recent training. Comprehensive features: Huge exercise database (1,500+) with videos. Routine planning tools – can filter exercises by muscle or equipment to build workouts. Template library includes popular programs (StrongLifts 5×5, PPL, etc.) for quick start. Logging UX: remembers previous weights to encourage progressive overload, supports supersets, drop sets, and notes, and automatically times rest periods. Cross-platform cloud sync (iOS, Android, web, even smartwatch) so data is always accessible. Analytics: charts for volume over time, one-rep max progress, PR tracking, and muscle group frequency. Large community (12+ million users) for sharing routines and motivation. Free tier available (low barrier to entry). UI is dated/cluttered according to some users (high feature count can overwhelm; e.g. some find routine creation “convoluted and clunky”). The app doesn’t “auto-adjust” workouts – relies on user or chosen plan to drive progression (less intelligent adaptation). Some features (advanced charts, etc.) locked behind “Elite” membership. Social/community features exist but not as engaging as dedicated social fitness apps. Freemium: Core features free (with no ads); paid Elite subscription adds advanced analytics and content. Also offers a separate coaching service.

(Other notable apps: Strong (popular pure log book with superb UI for quick logging, superset support, and Apple Health sync), StrongLifts 5x5 (simple app that auto-progresses a specific beginner program), Freeletics (AI-driven bodyweight workouts), Nike Run Club (guided running programs), Strava (endurance training log with social features), and CrossFit WOD trackers like BTWB, discussed below.)

### Coach-Athlete Platforms

Next, we explored software platforms designed for personal trainers, coaches, and their clients. These systems are B2B2C: coaches use them to deliver programming and track many athletes. Two leading examples are TrueCoach and Trainerize (along with others like TrainHeroic, TeamBuildr, etc.). Key aspects include calendar-based program delivery, compliance tracking, and communication tools.

TrueCoach – Caters to personal trainers and strength coaches who manage remote clients. Coaches build programs (a sequence of workouts, possibly weeks long) and assign them to clients on a calendar. The client uses a mobile app to view daily workouts (with demo videos attached), log results, and leave comments. TrueCoach provides a dashboard for coaches to monitor progress and “client compliance” (e.g. completed vs missed workouts). It also supports tracking custom metrics (body weight, body fat, max lift numbers), and even nutrition and habits. A built-in messaging feature enables coach-client communication in one place. Coaches can create reusable workout templates and then bulk-schedule or adjust them for individual needs. The platform recently introduced an AI Workout Builder to generate workout ideas based on client goals and experience. Strengths: TrueCoach greatly streamlines remote coaching – saving time with templates, providing professional exercise libraries, and centralizing data. It even integrates with wearables so that things like a client’s heart rate or run data auto-log for the coach. It also handles business needs: client billing (Stripe integration) and even custom gym branding. Weaknesses: TrueCoach is overkill for a lone user without a coach – it’s complex and oriented toward managing others. There can be a learning curve for coaches to fully utilize all features. Pricing is subscription-based (tiers by number of clients).

Trainerize – Another popular platform, similar in concept. It emphasizes a branded mobile app experience for clients, with workout programs, meal plans, and habit coaching. Trainerize integrates with apps like MyFitnessPal and Fitbit to pull in nutrition and cardio data. It also allows in-app purchase of training plans – enabling coaches to sell templates to the public. Compared to TrueCoach: Trainerize is a bit more all-in-one (incorporating nutrition tracking and even video calling for virtual training sessions). Its weakness can be a bloated interface and the fact that it tries to cater to gyms, studios, and independent trainers all at once. Pricing is likewise subscription per trainer.

Overall, coach-athlete systems inform our design by demonstrating robust programming tools (workout builders with calendars, templates), multi-channel tracking (workouts, nutrition, habits in one place), and the importance of feedback loops (messaging, form check videos). However, our personal training app (aimed at individual end-users) should avoid the complexity meant for managing others. Instead, we might borrow features like a calendar view of the training plan, or the idea of “program templates” that can be customized, as well as progress dashboards to keep the user accountable (much like a coach would).

### Wearable/Health Integrations

Modern training doesn’t happen in isolation – people track runs, sleep, heart rate, and more via wearables. Integrating recovery and readiness data can enhance workout recommendations. We focused on Whoop (a wearable strap known for its Recovery and Strain scores) since the client specified “Whoop only” integration. We also note patterns from others (Apple Health, Garmin, Oura ring, etc.).

Whoop Recovery & Strain: Whoop’s platform measures each day’s cardiovascular Strain (roughly, total effort from workouts and daily activity, on a 0–21 scale) and a Recovery score (0–100%) each morning based on heart rate variability (HRV), resting heart rate, and sleep quality. Whoop categorizes strain into ranges: e.g. 0–9 “Light” (room for more activity), 10–13 “Moderate,” 14–17 “High,” 18+ “All Out”. Recovery is likewise color-coded (green = recovered, yellow = medium, red = under-recovered). The principle is to adjust training intensity to your recovery – e.g. if your Recovery is low (red), you might back off training that day. Many coaching platforms now pull this data: for example, Whoop can sync to TrainingPeaks (a coaching app) so coaches see if an athlete is run-down or fresh. Fitbod’s app offers a simpler example – it can ingest activity data from Apple Health or Strava to update muscle recovery status in its algorithm

(so a logged 5km run would tag leg muscles as “used”). Similarly, Garmin Connect’s training plans use the device’s measured recovery and performance trends to adapt run workouts (Garmin’s “Coach” will reduce load if your recent runs or sleep indicate fatigue).

Integration patterns: Exposing wearable data in-app can be as simple as displaying the Whoop recovery score and perhaps a suggestion (“Recovery only 30% – consider active recovery today”). More advanced integration is feeding the data into the workout generator logic (e.g. auto-select an easier workout if strain has been high for several days). Some apps also log the workouts back to the wearable’s app – for instance, logging a strength workout to Apple Health for completeness. For our design, Whoop integration means using Whoop’s API to pull the user’s daily strain and recovery. We must handle that not all users will have Whoop; but for those who do, it’s a valuable data point. We should be careful to use this data to enhance recommendations without blindly overreacting to it. (E.g. a slightly low recovery score shouldn’t cancel a workout, but a string of low recoveries might trigger a deload recommendation.) We also note that some users might have other devices; designing integration via a service like Apple HealthKit (which aggregates multiple sources) could give broader support. However, priority is Whoop, which offers an API for real-time data.

### Spreadsheets and Notion Communities

Not all lifters use fancy apps – a substantial community relies on spreadsheets, Notion pages, or basic logs. We researched how and why people use these “roll-your-own” solutions, to ensure our design can offer the same flexibility and transparency that these users value.

Google Sheets / Excel Programs: There are countless Excel/Sheets templates for popular programs (Starting Strength, 5/3/1, Sheiko, etc.). Communities like LiftVault curate these: LiftVault provides hundreds of free program spreadsheets for powerlifting, bodybuilding, Olympic lifting, and more. Users typically enter their max lifts and the sheet auto-fills the weights to use each week (using formulas). The spreadsheet acts as both the plan and the log – the user might print it or pull it up on their phone at the gym and type in the weights they lifted. The appeal is trust and customization: a spreadsheet makes the programming fully transparent (every set and progression is visible, not hidden in an app’s algorithm). Power users can even modify them (e.g. tweak a percentage or add a set). Many lifters start with a simple linear progression spreadsheet because it’s straightforward and proven. The downside is manual effort and lack of guidance: the user has to remember to open it, input data, and interpret any analytics themselves. It’s easy to mess up a formula or forget to log a session. Still, the “it just works” reliability of a well-known spreadsheet (and the fact that you own your data in a file) is a strong draw.

Notion and Other Templates: Notion, a flexible note-database app, has community-made fitness templates as well. These often include a table for workouts, a table for goals, maybe relations to a table of exercises. They allow embedding progress charts or tagging workouts with muscle groups. Essentially, Notion can serve as a lightweight custom database for a training log. For example, one Notion fitness template automatically updates progress toward PR goals and has a linked nutrition log. The advantage is tight integration with a user’s journaling or daily planning (some users keep everything – work tasks, diet, and training – in one Notion workspace). The disadvantage is that Notion is not purpose-built for workouts: there’s no automatic timer or any intelligence to generate workouts – it’s all user-created.

In summary, DIY solutions teach us that users value control, transparency, and flexibility. Our system should allow users to access their raw data (export workouts, view history clearly) – so they feel it’s their log, not a black box. We might also provide ways to customize programming rules or choose from templates, to capture the “personal touch” people get from doing it themselves. Additionally, initial onboarding could offer known program templates (like those on LiftVault) to attract users who trust those plans. The key is to combine the convenience of an app with the empowerment of a spreadsheet (no hidden data, no forced rigid workflow).

### Open-Source Training Log Projects

Finally, we looked at open-source fitness apps to glean insights on data models and user-desired features (since open-source tools often arise to fulfill unmet needs of certain users, like privacy or specific functionality). Two notable projects:

wger Workout Manager: An extensive web-based workout manager that is free and open-source. It includes exercise databases, workout planning, logging, and even nutrition tracking. Wger can be self-hosted and even supports multiple users with roles (trainer, manager, member) for a gym context. It provides a REST API for integration. From wger, we note a well-structured data model: exercises (with categories, muscles, equipment), workouts composed of sets of exercises, and logs of workouts, all stored in a relational database (PostgreSQL). It even has features like automatic weight progression rules in custom routines. Wger’s breadth shows what a comprehensive system entails: tracking body weight, personal records, and providing an interface to edit or create routines freely.

LiftLog App: A mobile-focused open-source app (Android/iOS) aimed at being a lightweight, privacy-friendly gym log. It stores all data locally on the device (no cloud account required). The core philosophy, as stated by its developer: “having the app get out of your way and let you log with as little input as possible”. LiftLog allows users to select from a few included plans or create their own plan, then log workouts. It features one-tap logging (tap to mark a set complete) and automatic rest timers, prioritizing speed and usability in the gym. One paid feature it offers is an “automatic session creator,” hinting at an AI or rule-based generator for workouts, which the developer hosted server-side (to generate sessions based on the plan). LiftLog’s reception underscores the importance of a slick logging UX and offline capability. Users appreciated not needing an account and the intuitive interface (one commenter highlighted how quickly they set up sessions and how nice it was not to have “account BS” or lag).

Lessons from open-source projects include the value of offline-first design, data ownership (some users will choose a tool specifically because it doesn’t upload their data to a server), and minimalistic UI that focuses on core tasks. Also, open-source projects often implement standard structures (e.g., an Exercise entity with many-to-many relationships to Muscle groups, etc.) that we can emulate in our data model.

---

## Extracted Design Patterns

Synthesizing across all these sources, we can identify recurring design patterns and best practices that make for successful personal training systems. We also note anti-patterns or pitfalls as cautionary tales. Below we organize these patterns by functional area.

### Onboarding & Profile Setup

A well-designed onboarding is crucial to personalize training from the start without scaring off the user. Successful patterns include:

Collect Key Profile Info: All systems ask for the basics that drive programming. Common inputs are: current experience level (beginner/intermediate/advanced), primary goal (e.g. “build muscle”, “improve 5K time”), available equipment, and schedule (days per week available, workout length). Fitbod’s onboarding, for example, explicitly asks for goal, fitness level, and equipment, which its algorithm uses to generate the first workout. JuggernautAI goes deeper for advanced users (including specific max lifts and a target competition date). The pattern is to dynamically adjust the depth of questions based on user level: novices get a short, friendly quiz; advanced users are willing to fill in more detailed profiles.

Onboarding Program Selection: Some apps present template programs during onboarding. Jefit offers templates like 5x5 or Push/Pull/Legs for the user to pick from if they don’t want to create a routine from scratch. Similarly, LiftLog includes basic plans like StrongLifts. This gives users a familiar starting structure and reduces “decision paralysis”. Our design can incorporate a library of beginner programs to choose from at start, or an “auto-recommend” program based on answers (e.g. choose Starting Strength for a novice who selects “3 days/week” and “get stronger”).

Profile Customization & Updates: Good systems allow users to update their profile easily as things change – Fitbod lets you change your goal or available equipment at any time and immediately adapts workouts. We should make the training profile editable and perhaps even prompt the user periodically to review it (for example, if they’ve made progress, they might want to declare themselves “intermediate” now, or if they move gyms, update equipment list).

Injury and Constraints: A pattern just emerging is asking about injury history or exercises the user cannot/do-not want to do. Fitbod has a feature to “exclude” certain exercises (user can mark ones to do less or never). This is valuable to personalize around injuries or preferences (e.g., if someone has lower back issues, avoid barbell back squats and suggest alternatives). Our onboarding should include an optional “exclusions or special considerations” step – or at least a way to handle this in the profile settings.

Gradual Education: Onboarding can double as education. Some apps include brief tips about why they ask something or how the program works. For example, JuggernautAI explains its RPE-based approach during setup so the user isn’t surprised later. We should similarly set expectations: e.g., telling a new user “We’ll start conservatively to find your baseline; log honestly so the system learns and adjusts.”

In summary, onboarding should be as short as possible while gathering the essential inputs for personalization. It’s a balancing act: too few questions and the first workouts may be off-target; too many and users quit. A good strategy is a progressive onboarding: ask a few key questions to start exercising immediately, then over the first week collect additional data (perhaps via follow-up questions or simply by observing log data).

### Workout Generation Approaches

Several patterns exist for generating workout plans:

Template-Based Programming: Using predefined workout templates or programs is a straightforward approach. Many apps (Jefit, StrongLifts app) simply deliver a known program structure. The benefit is these programs are often tried-and-true. Templates can be parameterized with the user’s inputs – e.g., the 5/3/1 program spreadsheet calculates weights based on the user’s maxes. Our system can include a library of program templates (like those on LiftVault) to choose from. This covers users who want a traditional program and the predictability that comes with it. However, static templates don’t adapt to day-to-day variation or individual progress rates.

Rules-Based Generators: This is the “algorithmic” approach exemplified by Fitbod. Here, we define a set of rules and constraints, then generate each workout by solving for an optimal selection that meets those constraints. For instance, rules might include: “if a muscle group’s recovery < 50%, avoid heavy exercises for it” (Fitbod does this with its muscle fatigue scores). Other rules: ensure each major movement pattern (push, pull, squat, hinge, core) is hit weekly; ensure no exercise repeats too soon; match set/rep ranges to the user’s goal (e.g., strength goal means more sets of low reps, hypertrophy means moderate rep ranges, etc.). A rules engine can also incorporate progression logic: e.g., a rule might be “if user completed 3×10 last time, increase weight by 5% next time” (classic double progression). We likely will employ a rules-based system to dynamically adjust load and volume – similar to how Fitbod’s capability recommender adjusts sets/reps/weight based on 1RM formulas and previous performance. The advantage is personalization and reactivity to the user’s actual progress. The challenge is complexity: we must carefully design rules to avoid contradictory or nonsensical workouts.

Adaptive/Feedback-Driven Engines: These go a step further by using feedback loops. JuggernautAI’s system is a prime example – it doesn’t just follow preset progression, it actively listens to user input each workout (RPE and how the user feels) and adapts in real-time. Another example in endurance is Garmin Coach, which will change your future runs if you struggled with the last one. In our design, we can incorporate feedback by allowing the user to rate a workout or indicate difficulty, and adjusting future intensity. A simple implementation is an algorithm that looks at last week: if the user failed to hit the prescribed reps, it tempers the progression; if they hit them easily, it accelerates progression. Adaptive engines often require data (and can even involve machine learning to detect patterns over time), but given our scope, a heuristic adaptive approach is feasible (e.g., algorithmic auto-regulation rules).

Hybrid Approach: Likely the best solution is combining the above. We can start with a high-level template (e.g., a 4-day Upper/Lower split with a certain periodization plan) to give structure, but within that use a rules-based generator to fill in exercises and adjust loads day-to-day. This marries consistency with adaptability. For instance, the system might know “Monday is heavy squat day, Wednesday heavy bench day, etc.” (template), but exactly what accessory exercises or what weight to use is decided by rules considering the user’s recovery and last performance.

ML-Augmented Suggestions: Some apps claim “AI” or machine learning – Fitbod mentions using 400 million logged workouts to inform its recommendations. In practice, much of this can be encoded as statistical heuristics (like the 10-15% weekly volume increase guideline). Pure ML (like neural networks) isn’t common yet due to the difficulty of small data per user and the need for interpretability. We will be skeptical of heavy ML initially; instead, we can incorporate simple data-driven tweaks (e.g., use population data to estimate a beginner’s starting strength based on weight/age if they have no history, or to sanity-check progression rates).

Key considerations in workout generation for our system:

Inputs: User profile (experience, goals, equipment, time per workout), Recent performance logs (to know current abilities and fatigue), and perhaps Recovery data (e.g. from Whoop) as an input to modulate intensity.

Outputs: A sequence of workouts (could be generated one at a time or a whole week plan). Each workout is a list of exercises with sets/reps and target weights. Also potentially notes like “AMRAP last set” or “Superset these two exercises” as special instructions.

Constraint Solving: We will have hard constraints (e.g. must respect equipment availability; do not schedule two heavy deadlift days back-to-back; keep total sets within what time allows) and soft constraints (preferences like “user dislikes running, so if possible pick a different cardio modality”). A rule-based generator can treat soft constraints as things to fulfill only if it doesn’t violate a hard constraint or critical goal. If conflicts arise (say, user wants short workouts but also wants to hit every muscle twice a week), we might need to communicate and compromise (perhaps ask the user which to prioritize, or make intelligent cuts like dropping accessory work to meet a time constraint).

Progression Algorithms: We might support multiple schemes depending on context:

Linear progression for novices (each session add e.g. 5 lbs if last session was successful; reset if fail).

Double progression for hypertrophy (increase reps until a threshold, then increase weight and reset reps down).

Percentage-based cycles for strength (like a planned 4-week wave of 70%, 80%, 90%, deload).

Auto-regulation (RPE/RIR-based) for advanced users – which adjusts weight based on daily form (e.g. work up to a top set at RPE 9).

These can be built into the templates or rules. The system might default to linear for beginners and transition to more complex schemes as the user advances (explicitly or via detection of plateaus).

Deload and Variation: A common pattern in serious programs is to have a lighter week periodically to allow recovery (e.g. 1 week deload every 4-8 weeks). Our generator should incorporate deload logic – either automatically scheduling them every X weeks or detecting when one is needed (if performance is stagnating or recovery scores stay low). Exercise variation is another aspect: rotating exercises every cycle to avoid adaptation. For example, after 8 weeks of barbell back squats, a program might switch to front squats or pause squats for the next block. The system can maintain a list of alternatives for each major lift and swap them in periodically, or offer it to the user as an option (“Time for a new cycle – would you like to try a different main squat movement?”).

Substitution Logic: When generating a specific workout, if an exercise is contraindicated (by user preference or injury or lack of equipment), the engine should be able to substitute. For instance, if a plan template calls for pull-ups but the user indicated they have no pull-up bar, the rule might substitute bent-over dumbbell rows or lat pulldowns. A simple approach is tagging exercises by movement pattern and equipment, so we can find a viable alternative automatically. We should log the substitution so the user knows (“replaced Pull-ups with Bent-over Rows due to equipment constraints”) – transparency helps trust.

Safety Bounds: The system must avoid “programming itself into a corner” – e.g., increasing volume or intensity too quickly. Incorporating known safe progression rates (like not increasing total volume more than ~10% per week, as research suggests) is wise. Also ensure it doesn’t recommend extremely high 1RM percentages out of the blue. If the user’s data is sparse or inconsistent (garbage in, garbage out), the engine should default to conservative choices (better to under-shoot than injure the user). Some apps explicitly cap how fast they increase your weight – for instance, Fitbod will only bump weight when a user hits certain rep targets, not all at once.

In conclusion, our chosen approach will likely be a template + rule-based hybrid with adaptive feedback. This provides a backbone structure (which users psychologically appreciate – it feels like a “program”) and day-to-day tweaks that personalize and auto-correct the trajectory.

### Logging UX Patterns

Logging workouts is where users spend a lot of time, so optimizing this experience is critical. Patterns we’ve seen:

Minimal Input Logging: Reduce the friction to log each set. LiftLog’s one-tap logging is an ideal example: you tap once to mark a set done, and it logs the pre-filled weight/reps. Many apps pre-populate the logging fields with the planned or last used values, so if you did as expected, you tap and move on. If you did differently, you adjust the number then tap. Strong app and Jefit both recall previous data and make it editable in place. We will implement something similar: each exercise in the workout has its sets listed; tapping a set immediately records it as done with the default values, but the user can tap into the fields to edit if needed (e.g. if they got 9 reps instead of 10).

Support for Complex Set Structures: Strength training isn’t always straight sets of one exercise. Common patterns: Supersets (two or more exercises alternated with little rest), Circuits (3+ exercises in a cycle), Drop sets (reducing weight mid-exercise), Pyramids, etc. Users appreciate when an app supports these explicitly. For example, Strong allows grouping exercises into a superset so you can start the timer once for the group and log them together. Our design should allow marking certain exercises as a superset or circuit; the UI can then guide the user to do X then Y then rest, and possibly log the time for the circuit. Drop sets could be handled by allowing multiple weight entries for one exercise in one set notation, or simply by quickly adding another set at a lower weight. The key is flexibility – the user shouldn’t fight the app to log what they actually did.

Rest Timer Integration: Nearly all serious logging apps have a rest timer that auto-starts when you log a set. Typically, the default duration might come from the workout plan (e.g. heavy lifts 3 min, isolation 60 sec) or a user-defined setting. The timer should give a notification or vibration when time is up (especially important if the user isn’t staring at the app). Our system will include a rest timer that starts on logging a set completion, and possibly a visual countdown. Integration means if the user comes back early or late, they can manually skip or add time easily.

Editing and Corrections: Users sometimes forget to log until later or make mistakes. The UI should allow editing a set’s reps/weight after logging, and adding or deleting sets. A common pattern is the “+ Add set” button to record an extra set not originally planned, or a “skip” if they don’t do a planned set. Logging flexibility ties into data integrity: we need to decide how to treat edits in analysis. A good approach is an audit trail – e.g., keep the originally prescribed value but mark it as edited in the log. But for simplicity, many apps just update the data. We should avoid situations where a user cannot correct the log, as that leads to “garbage data” that can throw off the algorithm.

Partial and Missed Workouts: If a user does only part of a workout (time ran out or they skipped some exercises), the app should handle this gracefully. Some patterns: When finishing a session, ask “Completed all sets? Y/N”. If not, perhaps offer to reschedule the missed sets or auto-mark them as skipped. It might simply record what was done and note the rest incomplete. We might implement a simple approach: log what’s done and the remaining go to “planned” state; next time, the system could remind the user they have unfinished items or just treat it as a skip and move on (depending on the context of the program). Communication is key: the user should know if the system expects them to make it up or not.

Hands-free or Quick Access: Some apps integrate with voice or watch for logging. E.g., Strong has Siri shortcuts so you can log without looking at the phone. This is a nice-to-have pattern for reducing friction (especially if you’re, say, running or your hands are occupied). We might consider watch integration in later versions, but for MVP, a well-designed phone UI might suffice.

End-of-Workout Summary: After logging a workout, many apps show a summary: total volume lifted, any PRs achieved (“New 10RM PR for Deadlift!”), and perhaps prompt for feedback (“How did this session feel? [Great / OK / Hard]”). This serves both as a reward (seeing your accomplishments) and a data collection (the feedback). We should include a post-workout summary screen. If the user is in a hurry, it can be dismissible, but it’s good for engagement.

By implementing these logging patterns, we aim for a logging experience that is as quick (or quicker) than paper, handles real-world workout variations, and feeds accurate data back into our system.

### Progression Logic Patterns

Progression – the increase of workload over time – is the heart of making progress. Patterns observed:

Double Progressive & Rep Targets: A very common pattern for hypertrophy programs is setting a rep range for an exercise and increasing weight when the top of range is hit. For example, 3 sets of 8-12 reps: if the user manages 12,12,12 at current weight, next time increase the weight and drop reps back down. Our system can formalize this: each exercise could carry a rep range target and an increment amount. The app can automatically suggest the new weight once the user’s logged reps hit the threshold. This is essentially what Fitbod does by occasionally pushing “Max Effort” sets to evaluate if you can do more.

Percentage Based Progression: Many established programs use percentages of a known max (e.g. 70% 1RM for 5 reps, then 75% next week, etc.). This requires the user’s max or an estimate. Our system will inherently have 1RM estimates for exercises (via formulas like Brzycki’s from logged lifts, as Fitbod does). We can incorporate percentage programming especially for main lifts. For instance, an intermediate user’s plan might say: Week 1 do 3×5 @ 75% of squat 1RM, Week 2 do 3×5 @ 80%. The app would calculate the weight for them. Percentage progression is predictable and easy to communicate (“this is 80% so it should feel like a solid effort but not maximal”). We should allow using it in templates (especially powerlifting style cycles). One caution: 1RM estimates must be kept up-to-date; our system can update the training max each cycle (JuggernautAI recalculates 1RM about monthly and adjusts all loads accordingly).

Auto-Regulation (RPE/RIR): This pattern accounts for daily fluctuations. Instead of fixed reps or weight, the program gives a target effort. E.g., “Squat – work up to a set of 5 @ RPE 8 (2 reps in reserve)”. The user warms up and finds the weight that matches that exertion level. Subsequent work sets might be based off that. This approach, used by Juggernaut and many advanced lifters, can be more complicated for novices (who may not gauge RPE well). But it’s powerful to avoid both sandbagging and overreaching. Our design can include an optional auto-regulation mode for users who opt in (we’d need to have an RPE input on logging). Even if not in MVP, we design the data model to store RPE for sets, leaving room to use it in progression algorithms. For example, if a user’s logged RPE is consistently high for a given weight, the system might slow down progression or insert a deload.

Planned Deloads and Cycles: Pattern: Many programs use a cycle of increasing intensity or volume, then a lighter week (deload). E.g. 4 weeks increasing weight, 5th week lighter. Some apps like Garmin Coach schedule entire phases (base, build, peak, taper) in endurance training. In strength, 5/3/1 uses a 3-week wave then a 1-week deload. Our system can have a concept of a “block” or “cycle” length and automatically reduce the load or volume on the deload week (e.g., drop to 60% of normal volume). This prevents burnout and is a safety net. We might prompt the user or just do it automatically. A clever adaptation: if Whoop recovery data or performance metrics indicate accumulating fatigue earlier than planned, trigger an earlier deload.

Microprogressions: For time-crunched or less tolerant users, making very small increases (e.g., 1% weight increase or an extra rep only on one set) can be useful. Some advanced lifters use fractional plates to increase bench press by just 1-2 lbs at a time. We should allow small increments, especially if the user is plateauing – the system could try micro jumps instead of standard 5 lb jumps.

Plateau and Regression Handling: Eventually everyone hits a plateau or even regresses (due to illness, break, etc.). Pattern: Good systems detect this by looking at performance trends. Fitbod, for instance, flags if its strength metric is flattening or declining and will adjust programming (change volume or variation). Our analytics should highlight if an exercise hasn’t improved for, say, 3 attempts in a row. At that point, a pattern is to either deload (reduce weight and build back up) or swap the exercise for a while (to break monotony or address weak links). We can incorporate an automated check: if stagnation detected, app notifies user “Progress has stalled on X. We recommend a reset: reducing weight by 10% next week and building back up.” or “Consider switching out barbell bench for dumbbell bench for a cycle.” This is a coach-like intervention to keep progress going.

In implementing progression, transparency is key. The user should be able to see why the app is increasing or not increasing a weight. For example, a small note like “(increased weight by 5 lbs from last session because you hit target reps)” or conversely “(kept weight same because last time you didn’t get all reps)” builds trust and educates the user in strength training principles.

### Recovery & Readiness Integration

Patterns for using recovery metrics and managing fatigue:

Daily Readiness Check: Some systems present a daily readiness or recovery score prominently (Whoop, Oura, etc.). Even if our app doesn’t have its own score, integrating Whoop’s recovery percentage or HRV trend can serve this purpose. A pattern is to adjust the day’s plan based on it: e.g., if recovery is Green (good), maybe include an extra optional set or go for a PR; if Red (bad), either shorten the workout or swap a high-intensity exercise for a lighter one. Fitbod’s algorithm explicitly balances logged performance trends with recovery status to decide whether to push heavier or take it lighter. We can mimic this by having the workout generator consult recovery: perhaps tag each planned session as High, Medium, or Low stress, and allow the app to suggest “swap today with tomorrow” if recovery is low (for flexible scheduling), or automatically scale down intensity by, say, 10-20%.

Muscle-Specific Recovery: Fitbod’s unique approach is calculating a recovery percentage per muscle group. It essentially tracks how long since each muscle was worked and how much it was fatigued, then suggests what muscle groups to work next. In our design, we can track a simple metric: e.g., each exercise has a muscle impact and we assume a 48-72 hour full recovery time depending on intensity. This could feed the workout generator to avoid muscle overlap on consecutive days (like not scheduling heavy squats if quads are still at 50% recovery). Even if we don’t show a fancy muscle heatmap UI initially, the logic can run under the hood.

In-app Recovery Tools: Some apps incorporate recovery modalities – e.g., recommending a stretching or mobility routine on rest days, or tracking sleep hours. We might consider small features like a guided recovery workout (yoga, foam rolling) if the user is too fatigued for strength. It’s a nice value-add pattern but not core. However, scheduling “active recovery” sessions is a pattern (many athletes do dedicated recovery workouts when not lifting). We can include an option for the system to put mobility or cardio on off days, tailored to the user’s strain.

User Override and Feedback: It’s important that the user can override how the app interprets recovery. Some days you feel fine despite a low score, or vice versa. A simple pattern: ask the user “How do you feel today?” with options like “Energetic / Normal / Tired”. If they say “Tired,” maybe trigger a down-regulation even if Whoop said Green. Conversely, “Energetic” could mean go for it even if the device score was mediocre. JuggernautAI actually asks how you’re feeling before each workout and adjusts accordingly. We could include a quick daily questionnaire (1-2 questions) as optional input to refine the plan. Over time, it might even learn the correlation between subjective and objective (e.g., the user might always report feeling fine even when Whoop says not – then we trust the user more).

The pattern is clear: integrate recovery data, but use it as one factor among many, and give the user agency. The payoff is reduced injury risk and improved long-term progress. Users appreciate when the app “knows” they might need a break – it feels like having a caring coach.

### Analytics & Progress Tracking

Good analytics turn raw log data into insights and motivation. Patterns include:

Volume, Intensity, and Frequency Trends: Most tracking apps graph something over time. Common graphs: total volume (e.g. total weight lifted per week), average intensity (e.g. average %1RM used), workout frequency or consistency (sessions per week). These show the big picture. For example, seeing weekly volume rising can reinforce that you are training harder (or warn if it spikes too fast). Jefit’s analytics show training volume by week and can highlight muscle group volume to spot imbalances. We will implement trend charts for key metrics (likely in a “Insights” or “Progress” tab). Keeping them simple and with context (“up 10% from last week” annotations) helps user interpretation.

Personal Records (PRs) and Milestones: Recognizing PRs is highly motivating. Nearly all strength apps track your best lifts (1RM, 5RM, etc.) for each exercise and notify when you break them. BTWB takes it further with badges for classic CrossFit WOD benchmarks and lifts. We’ll include PR tracking: whenever the user lifts a weight or does reps that compute to a higher estimated 1RM than before, log it as a PR and congratulate them. Also, tracking milestones like “100th workout logged” or “10,000 lb lifted in total” can gamify progress.

“Strength Level” or Aggregate Scores: Some apps compute an overall score – Fitbod computes a muscle group strength score (mStrength) and overall strength score. BTWB computes a Fitness Level based on various benchmarks. These scores let users quantify their progress in a single number. While inherently reductive, they can be fun to track. We might implement a simple version: e.g., using a combination of the big 3 lifts for strength, or something like “work capacity score” for conditioning. If we do, we must explain it clearly and ensure it’s backed by real data (maybe using Sinclair or Wilks formula for strength to be weight-class neutral, etc.). This is a lower priority than fundamental analytics.

Adherence and Consistency: Since adherence is a primary goal, we should track it. Patterns: showing the number of completed vs planned sessions in a week or month, streaks of hitting all planned workouts in a week, etc. Trainerize for example might show a compliance percentage to coaches. We can surface to users something like “You completed 9 out of 12 planned workouts this month (75%).” And perhaps gently encourage improvement or praise consistency (if 100%, give a badge or positive feedback). If a user consistently misses a particular day (e.g., always skips Friday workouts), the system could notice and suggest a schedule change (that’s a smart adaptive touch a human coach might do).

Recovery and Performance Correlation: If we pull in Whoop or HRV data, we can present charts correlating it with performance. For instance, a scatter plot of daily recovery score vs. squat performance might show that bad recovery days often led to missed reps. We have to be careful not to overstate causation. But patterns like HRV trending down over a training cycle can indicate accumulated fatigue; some apps (EliteHRV, HRV4Training) specifically track a rolling average and flag if you’re outside your baseline. We can incorporate a simple indicator if recovery metrics degrade (maybe prompt a deload).

Visualization & Guidance: It’s not enough to show charts; guiding interpretation is a pattern of good design. For example, labeling a trend line green if it’s a positive trend or red if negative, or adding textual summary: “Your 1RM has increased 15% in 3 months – great progress!” Conversely, “You haven’t set a new PR in 6 weeks – consider adjusting your program.” This mimics a coach analyzing the data. We must be cautious with automated “insights” – they should be based on clear logic. Misleading analytics (like an arbitrary “strength score” that goes up and down inexplicably) can confuse users. So we’ll focus on tangible metrics.

https://www.jefit.com/use-case/workout-planner

Example of training analytics: Jefit app’s progress charts show a lifter’s one-rep max trend (left) and total volume by muscle group per week (right), helping visualize strength gains and balance.

Comparisons and Social Sharing: In community-oriented apps, comparing with others or sharing achievements is common. E.g., Strava has leaderboards for segments, BTWB has a gym leaderboard for WODs. In our case, unless we build a community feature, this might be out-of-scope initially. However, allowing users to export or share a summary (like posting their PR or weekly summary to social media) can be a light way to incorporate that motivation. We can consider generating a simple share image with their stats as a later feature.

To summarize, analytics should answer: “Am I making progress? Where? And what should I do next?” The patterns above ensure the user can see progress (or lack thereof) and the app can provide actionable insights. We will prioritize clear, user-friendly visuals with just a few key metrics for MVP, then expand as needed based on user interest.

### Notifications & Retention

Retention patterns revolve around nudging the user to stay consistent without annoying them:

Workout Reminders: Nearly every app offers a reminder at a chosen time or days (“Don’t forget leg day!”). The key is allowing the user to control frequency and timing. A good pattern is to ask during onboarding “When do you want workout reminders?” rather than assume. If a user usually works out M/W/F at 7am, a notification at 6:30am on those days can be helpful. If they miss a workout, perhaps an evening reminder “Did you work out today? If not, there’s still time or reschedule.” We should implement configurable reminders (with easy opt-out to avoid being intrusive).

Re-engagement Content: Some apps send “We miss you” notifications after a period of inactivity, or emails with motivational content/tips. For example, an app might say “It’s been over a week since your last workout – remember consistency is key! Need any help getting back on track?” We can set a trigger, say 7 days no log, to prompt the user gently. The tone should be supportive, not guilt-tripping.

Achievement Celebrations: When a user hits a milestone (PR, or completes 1 month of the program, etc.), send a congrats notification or email. This positive reinforcement is a pattern to drive engagement. E.g., “Congrats on finishing Week 4 of your program! Awesome dedication 💪”.

Content and Tips: Providing periodic value outside of just logging can retain interest. For instance, weekly summary emails (like “Your Week in Review: volume up 5%, 1 PR, keep it up!”) or in-app tip cards (“Tip: Sleep 8 hours to boost recovery – see your past week’s average sleep from Whoop” if integrated). This positions the app as a coach/educator. We should be careful to not overload with too many messages; perhaps an in-app feed or weekly digest is better than daily tips via push.

Community or Challenge Notifications: If we eventually add community features or challenges (e.g., a 30-day challenge), notifications related to those can spur usage. Since not in MVP, we note it for future.

The retention pattern essentially is: gentle, personalized nudges and celebrations of success. We want the user to feel the app is looking out for them, but not like it’s nagging. Also, any notification should have a clear action (open the app to log, or view stats, etc.) to avoid fatigue.

### Privacy & Data Security

Given health and performance data is sensitive, patterns here focus on transparency and control:

Data Ownership & Export: Users often want assurance they own their data. Good patterns: provide an export function (e.g., export workout history to CSV – Strong does this). Also, an account deletion that truly deletes data. We will allow users to export their logs easily and delete their account/data if needed.

Minimal Required Personal Data: We should not ask for more personal info than necessary. For example, you shouldn’t need to enter full name, address, etc., to use a training app. Email for account (if cloud sync) is enough; or allow anonymous local use (like LiftLog does with no account). If integrating Whoop or HealthKit, we must get user permission explicitly. Our system will follow the principle of data minimization: only collect what we need for functionality.

Encryption and Security: Patterns: encrypt sensitive data at rest (especially cloud-stored health metrics), use HTTPS for all data transfer, and perhaps end-to-end encryption if we ever sync personal health info. If we have a cloud service, we’ll implement secure authentication (consider OAuth if integrating other APIs). For local data storage, using the phone’s secure storage for any credentials or using well-tested databases for the logs is standard.

Transparency in Algorithm: While not exactly security, it’s related to trust: be clear about how recommendations are generated. Perhaps include a help section or tooltips that explain the algorithm’s considerations (“We increased your weight because you hit all reps last time. Next increase will happen when you hit 10 reps at this weight.”). This transparency not only educates but also reassures users that there isn’t anything creepy or inappropriate happening with their data.

Community Privacy: If/when any community or sharing features exist, ensure users opt in to share data. For example, if we ever have a leaderboard or social feed, let the user decide what is visible (some might not want their bodyweight or max lifts public). This pattern prevents privacy-conscious users from churning out.

Considering the user’s note that the system is health-adjacent, we might also eventually consider compliance with regulations like GDPR (if in EU) and maybe not quite HIPAA since it’s not medical advice, but if we integrate something like heart rate abnormalities, we’d need to be careful to disclaim that it’s not medical diagnosis. In short, the pattern to emulate is LiftLog’s ethos: store data locally (so it’s inherently private) and only sync/share when the user explicitly wants it. Our app should function offline and not brick if the user declines to connect to any cloud or wearable – that ensures maximum privacy for those who want it.

### Common Challenges & Pitfalls

Finally, from all systems we identified typical failure modes we must design around:

Garbage In, Garbage Out: If users log incorrect data (intentionally or not), the system can make bad recommendations. For example, if someone accidentally logs 500 lbs instead of 50, the algorithm might go haywire. We’ll include validations (e.g. warn if a logged value is wildly out of expected range) and allow easy corrections. The system should also be robust against missing data – e.g., if a user forgets to log a workout entirely, don’t assume they quit; maybe ask “did you skip or just not log?” before adjusting the plan drastically.

Overfitting Personalization Early: If the system adapts too quickly to limited data, it might draw wrong conclusions (like “user failed this workout, so dramatically reduce difficulty” when maybe the user was just tired that day). We should use longer-term trends or require a pattern before big changes. Essentially smooth out the adaptations and perhaps keep novices on a relatively fixed progression for a few weeks (since day-to-day variance is high when they’re still learning exercises).

User Preferences vs Optimal Programming: Sometimes user choices conflict with what’s “optimal” (e.g., user hates an exercise that is very effective). Our system should respect user agency (there are always alternatives) – forcing something leads to churn. If a user keeps skipping an assigned exercise, that’s a signal to swap it out automatically with a friendly message like “Not a fan of Bulgarian split squats? We’ve replaced them with lunges for next time.” The pattern is to detect non-adherence and adjust the plan to better fit the user, rather than blaming the user.

Exercise Naming and Taxonomy Chaos: With thousands of exercises out there, different names can refer to the same thing (e.g., “skullcrusher” vs “lying triceps extension”). If not handled, users get confused or duplicate entries in logs. We should maintain an exercise library with alias mapping (so the app shows the common name but knows equivalents). Also, searching for exercises should account for synonyms. Using an open-source exercise list

can jumpstart this. Ensuring consistency in naming and grouping (for muscle tagging, etc.) is a behind-the-scenes challenge to tackle.

Time & Equipment Constraints: The app could generate a theoretically great workout that is impractical in reality (too long, or requires two barbells at once). We must honor the user’s indicated session duration and equipment. Also consider gym context: maybe allow a “busy gym mode” where supersets that need two machines are avoided at peak hour. Some advanced logic could detect if workout is running long and offer to split it. But at minimum, our generator will strictly keep the workout within the time user set (e.g., if 45 minutes, cap sets accordingly).

Injury and Pain Handling: If a user reports pain or an injury, the system should adapt immediately. Unlike a human coach, an app might not know unless told, so we should encourage users to flag an exercise or input a note if something hurts. Then we can adjust (maybe switch all exercises that strain that area, or reduce load, or insert rehab movements). Not handling this would be a big pitfall (users will simply quit if the app keeps pushing something that hurts them).

Cold Start Problem: When a new user with no history joins, the system’s personalized engine has nothing to go on. Patterns to mitigate: use self-reported experience and some initial testing (Fitbod asks for a few initial max or rep-capability inputs, Juggernaut has you do an intro week). We can include an initial test workout or ask the user to estimate their capabilities (“What’s the heaviest weight you can squat for ~5 reps?” etc.) – or use defaults for true beginners. Also, initially err on the side of easy to gather data and avoid overwhelming them.

Long-term Engagement vs Novelty: Many users churn out of boredom or lack of variety. Our adaptation and variation patterns (exercise rotation, new phases) should help keep it fresh. But we must balance novelty with consistency (too much random variety and progress stalls). Ensuring the app communicates the purpose of phases (“we’re in a high-volume phase now to build base strength, it’ll change next month”) can keep users mentally engaged. We might also periodically ask for goals update, so if their goals shift, the programming shifts – preventing mismatch over time.

Offline Mode & Sync Issues: If we allow offline use (which we plan), synchronization when coming back online can cause duplicate logs or data loss if not careful. Using a reliable timestamped log and perhaps not generating two different future plans on two different devices at once will be important. We might avoid multi-device editing in MVP to simplify (e.g., primarily target phone usage).

Metric Obsession & Misinterpretation: If we provide many metrics, some users might fixate on ones that don’t matter or misread them (like freaking out that their recovery score is 55% without understanding context). We should guide users to focus on key metrics (like PRs, consistency) and perhaps hide overly complex ones by default. Also disclaimers where needed (especially around things like “calories burned” or “bodyweight trends” – since weight can fluctuate due to many factors). Present data, but also educate.

By anticipating these challenges, we can design the system to gracefully handle them, leading to a more resilient and user-friendly product. Next, we integrate all these patterns and findings into our proposed system design.

---

## Proposed System Design

Using the research insights and patterns above, we now outline the design for our personal training system. This includes the system’s objectives and scope (A), target users and their journeys (B), the conceptual data model (C), the workout generation engine (D), the logging experience (E), analytics and feedback features (F), a development roadmap (G), and implementation details including integration and privacy (H).

### A. System Goals and Non-Goals

Goals – what we optimize for:

Adherence & Consistency: The top goal is to help users stick to a training regimen. This means the system should be easy and even enjoyable to use regularly. Features serving this goal include intuitive logging, reminders, and adaptive programs that fit the user’s life (so they are less likely to quit due to schedule mismatches or boredom).

Progressive Overload & Results: Ensure users make measurable progress toward their fitness goals (strength gains, hypertrophy, endurance, etc.) through the principle of progressive overload. The system will track performance and incrementally increase demands in a sensible way so that users improve while minimizing injury risk. Essentially, we want to replicate a good coach’s approach: push when the user is ready, hold back when recovery is needed.

Personalization & Adaptation: Provide tailored workouts for each user’s profile and adjust over time based on their performance and feedback. This includes accommodating each user’s goals, experience, available equipment, and recovery signals. For example, two users of different experience will get different programs, and the same user’s plan today might change next week if data shows they are struggling or breezing through. Personalization should also cover user preferences (favored or disliked exercises) so the program feels “made for me.”

Injury Risk Minimization & Recovery Balance: A subtle but important goal: the system should not drive the user into the ground. We optimize for longevity in training. That means programming rest days, deload weeks, and monitoring fatigue (via Whoop recovery or performance trends) to avoid overtraining. If the user flags pain or the system detects stagnation, it will respond appropriately (modify volume, suggest easier variation, etc.). Safely keeping the user healthy ensures they can stay consistent (tying back to goal #1).

User Empowerment through Data: While the system automates decision-making, we want to educate and empower users with their data and rationale. A goal is that users not only get fitter but also learn why they’re doing what they’re doing. Through clear analytics and transparency (e.g., showing how their 1RM is improving or why weight was increased), the system builds the user’s confidence and knowledge. An informed user is more likely to trust the system and remain engaged.

Seamless Integration with Lifestyle: The system should integrate (technically and behaviorally) into the user’s life. On the technical side, that means syncing with tools they already use (like Whoop for recovery, Apple Health for diet or steps, etc.) so it becomes a hub for their fitness data rather than an isolated silo. On the behavioral side, it means fitting their schedule (workout lengths that fit into their day, and flexibility if they miss a workout to get back on track smoothly). Ultimately, the app’s role is to reduce friction between the user and exercise – whether that’s by convenient design or intelligent planning.

Non-Goals – what we deliberately do NOT address now:

Diet/Nutrition Planning: Apart from maybe letting users log body weight or sync their calorie data for context, we will not attempt to provide meal plans or detailed nutrition coaching. That is a whole domain itself (some apps combine both, but it adds complexity and possible regulatory concerns). We assume the user may use another app for diet or have their own approach. Our focus remains workouts and recovery.

Medical Advice or Physical Therapy: The system is not a doctor or physio. We don’t diagnose injuries or prescribe rehab beyond simple adjustments like skipping certain exercises. If a user has a significant injury or condition, we expect them to use the app under guidance of a professional or after recovery. We will include disclaimers accordingly. We will however allow the user to manually adjust the program for injuries (like toggling off certain movements), but we won’t generate injury-specific programs (like “rehab for torn ACL” – out of scope).

Social Network / Competitive Features (MVP): While community can improve motivation, building a full social platform (friending, feeds, leaderboards) is not an initial goal. It requires critical mass of users and moderation etc. Instead, our initial design focuses on the individual experience. We might incorporate lightweight sharing or comparing against general benchmarks, but nothing like a full-fledged social feed in V1. (This can be revisited once core functionality is rock solid.)

Coaching Marketplace: Some platforms let you hire a human coach or buy programs (e.g., TrueCoach is exploring public profiles for coaches, BTWB sells programs from star athletes). Our system is meant to be a self-contained digital coach. We are not building a marketplace for trainers or selling third-party programs in the initial scope. (However, incorporating well-known programs internally is part of the design, just not user-to-user transactions.)

Extremely Niche Training Modes: We focus on general strength and conditioning. We are not explicitly building for specialized sports (e.g., marathon training plans, powerlifting meet peaking cycles, Olympic weightlifting technique analysis, etc.) in the first iteration. The system can handle strength, hypertrophy, basic endurance and HIIT for general fitness and maybe hybrid fitness, but it won’t, say, plan a periodized marathon run plan with speedwork (that’s a niche best left to specific apps or a later feature). Non-goal for now is to cater to every possible training modality (like swimming workouts, or yoga sequences, etc.). We will cover the broad categories but not every sport.

Gym Management / Multi-user Training: Unlike wger which doubles as a gym management tool with multiple trainers and clients, our system is strictly personal-use oriented. We’re not building features for a coach to manage clients, nor membership billing, etc. One user’s data and plan is siloed to them (unless they manually share it). This keeps our scope focused on the individual experience.

By clarifying these non-goals, we ensure our design remains focused. We’ll deliver excellence in the core function (personal workout programming and tracking) before considering expansions into those other realms.

### B. Personas and User Journeys

We target a range of user types (“personas”) to ensure the system meets different needs. Below are key personas with their characteristics, followed by primary user journey scenarios demonstrating how each would interact with the system. Personas:

Novice Nancy – Profile: Beginner to structured exercise. Perhaps has done some workouts from YouTube or random gym visits but no consistent program yet. Maybe intimidated by complex routines. Needs: Simple guidance, encouragement, and education. Short workouts (maybe 30-45 min) 3x/week. Behavior: Will rely heavily on app’s suggestions, unlikely to tweak settings initially. Might not know many exercise names. Success = building a habit and seeing initial strength or fitness improvements safely.

Intermediate Ivan – Profile: Has 1-2 years of training experience or tried various programs. Comfortable with basic lifts. Possibly hit a plateau on his own and seeks more structure. Needs: A program with progression to break plateaus, slightly more volume, and maybe variety to keep things interesting. Appreciates data and tracking PRs. Behavior: Will log diligently and pay attention to the analytics. Might adjust a few things (e.g., swap an exercise he dislikes). Success = setting new PRs, e.g., improving big lifts or muscle gain over a few months.

Advanced Alice – Profile: 5+ years of training, possibly a competitive lifter or athlete. Very knowledgeable (may have her own philosophies) but interested in tech to optimize further. Needs: Fine control and high customization. Likely wants to input her own program parameters (or even entire program) and use the app to log and analyze. Alternatively, she might use the app’s engine but scrutinize its decisions. Values things like RPE logging, detailed analytics, maybe export data for her own analysis. Behavior: May bypass the default generator to set up custom training blocks, or use advanced features like changing progression schemes. Success = continuing to make incremental gains or successfully peaking for an event, while using the app as a sophisticated log and planner.

Hybrid Harry – Profile: Interested in multiple modalities (e.g., does CrossFit or both lifting and running). Perhaps trains for obstacle races or just enjoys variety (strength + cardio + sports). Needs: Flexibility in programming to accommodate different training (maybe needs 2 dedicated run days and 3 lift days, etc.). Integration with a device (like Whoop) is valued to monitor recovery because hybrid training can be taxing. Behavior: Will use scheduling features actively (to balance run days vs lift days), and will appreciate if the app can adapt lifting workouts based on the fatigue from runs. Success = improving both strength and endurance without injury or overtraining, with the app helping balance these.

Time-crunched Tom – Profile: Busy professional or parent with very limited time. Might only squeeze 2-3 workouts a week, sometimes unpredictably. Needs: Efficient workouts (maybe full-body or circuit style) that maximize results in minimal time. Adapts schedule on the fly. Possibly at-home workouts with limited gear. Behavior: May often use the app’s feature to generate a quick session (“I only have 20 minutes, what can I do?”). Might skip or move workouts often, so needs easy rescheduling. Success = maintaining consistency (not falling off during busy periods) and slowly improving fitness or at least not backsliding.

These personas cover our spectrum from beginner to advanced, and generalist to hybrid. Now we illustrate primary user journeys: Journey 1: Onboarding to First Workout (Novice Nancy)

Nancy downloads the app after a friend’s recommendation. She opens it and is greeted with a brief welcome and questions: It asks her experience level (she selects “Beginner”), goal (“Tone up and get stronger” – in our terms that maps to a general strength/hypertrophy goal), available equipment (“Basic gym” – she checks off dumbbells, barbell, etc., or selects a preset gym list), and days per week (she chooses 3 days). The app suggests a plan: “Full-Body Beginner – 3x/week”. It explains this will hit all muscle groups each session with moderate volume, ideal for learning basics. She accepts and sees her first workout ready (perhaps titled “Workout A”). She goes to the gym and opens Workout A. It lists 5 exercises: e.g., Squat, Bench, Row, etc., with 3 sets each. She’s unsure about form for some, but each exercise has a thumbnail and she taps one to see a quick video/demo and tips. She starts with Squats: does a warm-up (the app suggested in a tip “do 2 light warm-up sets”, which she does but doesn’t need to log separately, or she can log as warm-up if she wants). Then she performs set 1. The app had pre-filled an initial weight suggestion (maybe based on her body weight or a default like empty bar), but she uses a different weight. She taps the weight field, edits it, and logs 8 reps. She taps “Done set”. The app starts a rest timer for 90 seconds. She sees “Next set: aim for 8 reps at the same weight”. She does set 2, logs it similarly. After finishing Squats, the app calculates an estimated 1RM from her sets and notes “Est. Squat 1RM = X lbs” internally. She continues through the workout, logging each set. The last exercise is Plank (bodyweight core), which has a timer to log duration – she logs 30 seconds hold. Workout complete! The app shows “Great job!” and a summary: total time, total volume, and highlights “New Exercises Learned: Squat, etc.” or “Bench Press – initial 1RM estimated at 50 lbs” (some positive reinforcement that she started a journey). It asks a quick feedback: “How was this workout? Too Easy / Just Right / Too Hard”. Nancy felt challenged but okay, so she taps “Just Right.” The app says “Got it. We’ll keep pushing gradually. See you for Workout B on Wednesday!” and perhaps offers to set a reminder. Nancy leaves the gym feeling accomplished and trusts that Workout B will build on this. Indeed, behind the scenes the system will slightly increase some weights or reps for Workout B based on her performance. Journey 2: Mid-program Adaptation (Intermediate Ivan)

Ivan has been using the app for 6 weeks on a 4-day Upper/Lower split program that the app generated for him. He’s been consistent. This week, on Monday (Upper body day), Ivan feels a bit tired and during his bench press sets he fails to hit the target reps (he was supposed to do 5 reps at 200 lbs, but managed 3, then 4 after lowering weight). He logs what happened with actual reps and even marks an RPE 10 (max effort) on the last set. The app flags this internally. At end of workout, it asks “Today’s bench sets were tough. How do you feel about that exercise?” Ivan notes “Felt unusually hard.” On Wednesday (Lower body day), the app notices Ivan’s Whoop data: his recovery score has been <40% (red) for two days, corroborating that he might be fatigued. It decides to adjust Friday’s upcoming Upper day by initiating a mini-deload for bench press. On Friday, when Ivan opens the app, he sees the workout and a pop-up: “Noticing some fatigue on Bench Press – we’ve reduced the weight by 10% this session to help you recover. Let’s come back stronger next week!” Ivan appreciates this, as he indeed wasn’t feeling 100%. He does the workout with the adjusted weight, hitting all his reps this time with better form. The following week, the program resumes normal progression on bench (maybe with a slightly smaller increment than originally planned). Additionally, the app might shuffle his accessory exercises or add an extra rest day before the next heavy bench, based on that feedback. Later in the program, Ivan hits an 8-week mark. The app shows him a progress review: his Squat 5RM improved by 20 lbs, his weight has increased 5 lbs (if he logged bodyweight), etc. It suggests starting a new cycle with perhaps a switch from barbell bench to dumbbell bench for variety, given he plateaued on barbell. Ivan agrees and the next block is generated accordingly. This journey shows how an intermediate’s program evolves and how the app handles feedback (failed reps and recovery data) to adapt programming (small deload and exercise variation). Journey 3: Customization and Advanced Use (Advanced Alice)

Alice downloads the app mainly as a logging and analytics tool, as she already has a coach’s program (or her own). Onboarding for her: she selects “Advanced” and perhaps chooses a “Create your own program” option. She manually inputs her current regimen: 5-day Push/Pull/Legs split + 2 cardio days. The app’s UI for custom program creation allows her to specify each day’s exercises, sets, reps, and even tag which ones use RPE. She sets this up for the next two weeks (she has it on paper from her coach). She’s impressed the app has her obscure accessory exercises in the database (the alias system helped here). She starts logging workouts. After a couple weeks, she explores the analytics tab. She sees detailed charts – e.g., her 1RM for Deadlift trending upward, and a slight imbalance where her pushing volume is much higher than pulling. The app actually notifies “Your training volume for chest is 25% higher than back over the last month. Consider adding some rows or pull-ups to balance.” Alice realizes she has indeed neglected rows and appreciates the insight. She modifies her program to add an extra rowing exercise on pull day. Alice also integrates her Whoop account in settings. Now the app logs her sleep and recovery data. One day, she gets a Whoop alert that her recovery is very low. The app then marks her planned intense leg workout with a suggestion: “Maybe do an active recovery or swap to a lighter session today.” Since she’s advanced and in tune with her body, she decides to still do the workout but perhaps shortens it. The app logs it all. As Alice prepares for an upcoming powerlifting meet 12 weeks out, she switches to an app-provided “Meet Prep 12-week” template that she fine-tunes. The app handles the heavy percentage-based progression and tapering for the meet (Alice input the meet date, so the program auto-calculates phases backwards). During this period, the app’s adaptive logic doesn’t need to do as much since Alice is mostly controlling it, but it still tracks her fatigue. Post-meet, the app congratulates her and suggests a deload week plan to recover. This journey illustrates how an advanced user can still derive value: full customization, granular data, and the app serving as a smart logbook and planning assistant rather than a strict coach. Journey 4: Time Management and Missed Workouts (Time-crunched Tom)

Tom started with a 3x/week program, but his work got busy. One week, he only did 1 out of 3 workouts. The app notices two sessions went unlogged. Instead of scolding, it sends a friendly prompt: “Tough week? It happens. Your missed workouts are waiting – you can reschedule them or let’s adjust your plan.” Tom opens the app on Sunday. It offers options: “Catch up missed workouts” vs “Recalculate next week’s plan”. Tom chooses recalculation. The app then regenerates a new week with perhaps slightly reduced progression (recognizing he had a break) and ensures no muscle group was completely ignored (maybe merging key exercises from missed sessions into the next ones). It also offers “Would you like to reduce your schedule to 2 days a week for now?” – Tom indeed switches to 2x/week to be realistic. During workouts, Tom often is pressed for time. The app UI prominently shows elapsed time and remaining exercises. If it looks like he won’t finish in his target 30 minutes, the app might suggest on the fly: “Skip isolation exercises if in a rush – focus on the next compound move.” Tom uses that tip and finishes on time. The skipped exercises are either recorded as skipped or the app automatically schedules them as optional add-ons next time. Tom also leverages an “instant workout” feature occasionally: e.g., one day he has a surprise free 20 minutes. He opens the app and uses a Quick Workout generator (maybe selecting “20-minute full-body dumbbell circuit”). The app generates a high-intensity circuit and he does it. This wasn’t part of his long-term program, but the app treats it as an extra session. It still logs the volume and accounts in recovery but doesn’t alter his primary progression except noting that those muscles got work. This journey shows how we handle missed sessions and flexible scheduling, keeping Tom engaged rather than feeling like he failed the program. Over time, Tom’s adherence improves because the app helped adjust to his life, rather than expecting rigid perfection. Across these journeys, we see common flows: onboarding, plan generation, workout execution logging, weekly reviews, and program adjustments. Each persona puts different stress on the system’s features (education for novice, adaptation for intermediate, customization for advanced, integration for hybrid, flexibility for busy user). Our design as detailed in upcoming sections (C through H) will ensure all these use cases are supported seamlessly.

### C. Canonical Data Model

We outline the core entities (data objects) and their relationships in the system’s conceptual schema. This isn’t a full ER diagram but describes how we structure the information about users, workouts, exercises, etc., to support the functionality.

#### User

Represents the individual using the app. Each User has:

Profile attributes: name (or alias), age (optional, for calorie or prediction calculations), maybe sex (if needed for certain strength standards), and login credentials (if cloud sync; not needed for purely offline).

TrainingProfile: This is a sub-entity or related entity capturing training-specific settings:

Experience level (e.g., Beginner/Intermediate/Advanced as selected)

Goal(s) (could be a simple enum like Strength / Hypertrophy / Endurance / General Fitness; could allow multiple or a ranked priority)

Schedule: preferred workout days per week or specific days (e.g., “Mon/Wed/Fri” or “3 days flexible”), and session length preference (e.g., 60 min).

Equipment list: which equipment is available. This can be stored as a set of tags (dumbbell, barbell, squat rack, bench, pull-up bar, etc.).

Exercise exclusions: list of exercises (or exercise categories) the user doesn’t want. Alternatively, we store this in a UserExercisePreference entity (with fields like exercise and preference level like “avoid” or “prefer”).

Injury flags or special notes: e.g., user can mark “bad knees” or “shoulder pain with overhead” – which we could interpret into excluding certain moves or recommending alternatives. This might be free text or a checklist (for known common issues).

Linked accounts: e.g., Whoop linked = true (with tokens), Apple Health permission granted, etc., which tell us to import data from those.

Historical metrics: current body weight, maybe body fat %, any performance assessment they input initially (like if they tested 1RM or mile time at start, we can store baseline).

(Note: Many of these are set in onboarding but can be updated.)

#### Exercise

Master list of exercises. Fields:

Name (primary name, e.g., “Barbell Back Squat”).

Aliases (array of other common names, e.g., “Back Squat” or “High Bar Squat”). Searching should match these.

Muscle groups targeted: one primary, possibly multiple secondary. Could link to a Muscle entity (like quadriceps, hamstrings, glutes for Squat) to power muscle-based analytics.

Movement pattern / category: e.g., Squat Pattern, Hip Hinge, Horizontal Push, Vertical Pull, Core, Conditioning, etc. This categorization helps ensure balanced programming and finding subs (we’d replace an exercise with another of same category if needed).

Equipment needed: e.g., Barbell, or “Machine: Leg Press”, or “No equipment (bodyweight)”. This is matched against user’s equipment list to filter suggestions.

Difficulty or skill level: a rating if we want to avoid very technical lifts for novices (like Olympic lifts could be marked advanced).

Force type: optional (e.g., push vs pull), used to identify push/pull imbalances.

Unilateral/Bilateral flag: e.g., Lunge is unilateral (each side), which might influence programming (ensuring both sides etc.).

Media/Instruction: link to a video or images and a short instruction text.

(Optional advanced) Tags like “compound vs isolation”, “strength vs accessory” etc.

#### WorkoutTemplate

A template for a workout (planned). This could correspond to a day in a program. Fields:

ID, Name (maybe “Workout A” or “Upper Heavy” etc.).

A list of WorkoutTemplateExercise entries, each of which includes:

Exercise reference (to the Exercise entity).

Prescribed sets, reps, and intensity. Intensity could be a specific weight or %1RM or RPE target. We need to accommodate different modes:

For fixed weight: store as a number (could be updated once we know user’s strength).

For %1RM: store as something like 0.75 (75%) and the system will calculate actual weight based on user’s latest 1RM for that exercise.

For RPE: store target RPE (like 8) and perhaps a rep count (“5 reps @ RPE 8”). The actual weight is determined on the fly when logging.

For bodyweight or endurance exercises, intensity might be “Max reps” or a duration.

Rest period guideline (e.g., 2 min).

Order and grouping info: e.g., if exercise 1 and 2 are to be a superset, we mark them as such (maybe have a group ID or flag).

Tempo notation or other advanced cues (optional text like “3-1-1 tempo”).

(Optional) Note field like “AMRAP last set” or “Warm-up sets: 2”.

Essentially, WorkoutTemplate is like a structured plan for one session.

#### Program

Represents a structured sequence of workouts meant to achieve a goal. It could be generated by the app or selected template. Fields:

ID, Name (e.g., “Full-Body Beginner 6-week” or “Alice’s Meet Prep Block 1”).

Phase/Cycle info: possibly subdivided if needed (e.g., Weeks 1-4 hypertrophy, Weeks 5-8 strength).

A schedule of Workouts: could be an ordered list of WorkoutTemplates with associated days (Day 1, Day 2, etc.) and maybe repeat patterns (like if it’s a week template that repeats).

Start and end (or ongoing). If ongoing, it might be open-ended like “Greyskull LP until you stop progressing”.

Version or history: If the program is regenerated or adjusted, we might keep an archive or version number. For example, Program v1 is original, then user changed schedule so Program v2 is updated. We store so that past workouts remain linked to the old version but new generation uses new version. (This is an advanced feature; simpler is to treat program dynamically, but we risk rewriting history if not careful. E.g., if someone deletes an exercise from the program, their past log with that exercise should still reference the exercise even if it’s no longer in current plan.)

If the user is not following a named “Program” (like they just do one workout at a time), we might have a default program that’s always ongoing.

#### ScheduledWorkout

This could be an instance of a workout scheduled on a specific date. Alternatively, we handle scheduling by having Program specify what day of week corresponds to which workout template. But for flexibility (especially if user moves workouts around), it might be easier to have a calendar of ScheduledWorkout objects:

Fields: date (or week index and day index within program), pointer to a WorkoutTemplate (or a deep copy if it has been customized for that day), and a status (Planned, Completed, Missed, etc.).

If a user delays or reschedules, we update the date.

If a workout is skipped, we mark as Missed or move it.

This allows for irregular schedules (unlike a rigid pattern).

ScheduledWorkout essentially is what appears on the user’s timeline/calendar.

#### WorkoutLog (Performed Session)
 When the user performs (completes) a workout, we create a WorkoutLog entry.

It links to the ScheduledWorkout (if it was planned; if it was an ad-hoc quick workout, it might not have a pre-planned entry, but we can still log).

It has date/time, duration.

It contains a list of SetLog entries detailing what was done:

Each SetLog links to an Exercise (or ideally to the WorkoutTemplateExercise if it was planned, for context).

Fields: weight used, reps done (or distance, duration, etc., depending on exercise type), RPE or notes if user entered, and a set index.

If an exercise was planned for 3 sets and user did 4, we’ll have 4 SetLogs (the extra one would have no matching template set unless we allow variable sets).

If user skipped some sets, we might log nothing for those or mark them skipped – maybe simply the absence of a SetLog indicates it wasn’t done.

For timed exercises (plank, cardio): we might use the “reps” field to store seconds or have a separate duration field.

We include a flag if this set was a PR (the logic to mark PR could mark the entry).

The WorkoutLog also can store summary metrics: total volume, average intensity, etc., that we can compute on the fly or store for quick retrieval.

Possibly store user subjective rating for the workout (e.g., 1-5 stars or a quick survey answer).

#### Progress Metrics & Derived Data

ExercisePerformance: We might maintain running records per exercise, like the user’s current 1RM estimate for each exercise. This can be computed from logs using formulas, but storing it can save time and allow showing history. For each exercise, store last tested 1RM or rep PRs. We can update these whenever a new log surpasses the old.

MuscleGroupVolume: For analytics, we might aggregate weekly volume per muscle group and store it in a small table for quick graphing. Or just compute from logs on the fly using exercise muscle mappings.

Recovery & Wellness: We create an entity for daily wellness metrics:

date, recovery score (from Whoop or user input), sleep hours, resting HR, etc. If user doesn’t have Whoop, this might remain empty or only have what they manually input.

Adherence: Could be derived as (#completed / #planned) in a period. Probably computed rather than stored, unless we want to track trends (we could store a weekly adherence % in a log table too).

Notifications/Reminders: Possibly an entity to store scheduled notifications (like “remind user at 7am MWF”). But that might be more an OS-level scheduling rather than a data entity. We could keep user preference for notification times in the User profile.

Audit/History: If we want to keep a history of program versions or user changes, we might have:

e.g., ProgramHistory or WorkoutTemplateHistory if needed.

But to keep it simpler: Completed logs themselves serve as history even if program changes later.

Integration Entities:

Whoop data might not need a separate entity beyond what’s in recovery metrics. But if we fetch detailed data (like sleep stages, HRV values), we might store those in a normalized way (e.g., SleepNight entity with duration, sleep performance, etc.).

If we plan to import every run or activity from Apple Health, we might have an ActivityLog for non-workout activities. Fitbod just uses outside workouts to adjust recovery, so we might simply update recovery metrics rather than logging every external activity in full detail.

Relationships in summary:

User has one TrainingProfile.

User has many Programs (current program and possibly past ones).

Program has many WorkoutTemplates (or references them).

Program or User has many ScheduledWorkouts (each referring to a WorkoutTemplate, date, etc.).

ScheduledWorkout when completed yields a WorkoutLog. (ScheduledWorkout could even be merged with WorkoutLog conceptually, with a flag planned vs completed, but separation is cleaner.)

WorkoutLog has many SetLogs.

Each SetLog references an Exercise.

Exercise links to muscle groups (many-to-many if one exercise hits multiple muscles).

User links to wellness entries (one-to-many per day).

Many of these will be keyed by user to separate user data.

Versioning / Audit Consideration: To ensure “regeneration doesn’t rewrite history,” we separate planned data from logged data. Logged workouts record exactly what happened, independent of any subsequent plan changes. If we regenerate the future schedule, it should not alter past WorkoutLogs. We also probably won’t retroactively edit past planned entries; if a workout was planned but missed, we might mark it missed but not delete it, for example. Essentially, once a workout date passes, either it becomes a log or stays as a missed plan record, but new generation should only affect future-dated plans. Example Data Model Scenario:

User Nancy (ID 1) has TrainingProfile: beginner, goal=general, schedule=3/wk, equipment [DB, BB, etc].

Program (ID 101) “Full-Body Beginner” has WorkoutTemplates: A and B alternating. WorkoutTemplate A has exercises: Squat (3x8 @ maybe a % or bodyweight), Push-up (3x10 bodyweight), etc.

ScheduledWorkouts: generated 6 instances: Week1 Mon -> A, Wed -> B, Fri -> A, Week2 Mon -> B, Wed -> A, Fri -> B, etc.

Nancy completes Week1 Mon. A WorkoutLog (ID 5001) is created linking to that ScheduledWorkout. It contains SetLogs for each exercise with actual reps/weights she did.

Meanwhile, Program 101 remains unchanged template. She then maybe updates equipment (adds a kettlebell at home). That doesn’t change past workouts at all.

If we update Program (like swap an exercise), we might either version Program or simply note that any future ScheduledWorkouts not yet done will reference the new template. Past WorkoutLogs referencing old exercise ID will still find that exercise in the library, and maybe the old template is kept until all scheduled instances are done.

The data model thus preserves history.

This conceptual model will drive how we implement storage (be it local DB or cloud DB). It’s designed to answer queries like: “What is the user doing today?”, “What did they lift last session for exercise X?”, “How has volume on muscle Y changed over 4 weeks?”, “What’s the next workout and when?”, etc., which cover our functional needs.

### D. Workout Generation Engine

We propose the architecture and logic for generating and adapting workouts. There are a few viable approaches, as discussed, and we will recommend a hybrid solution: Architecture Overview:

We will implement a Rule-Based Adaptive Generator built on templates. Concretely, we’ll have base templates for common programs (full-body, upper/lower, push-pull-legs, etc.) and goal-specific schemes (strength vs endurance emphasis). When a user onboards, the system selects an appropriate template (or builds one dynamically) as a starting point. Then, for each workout instance, the engine applies rules to customize exercise selection (if needed) and adjust the load/rep targets based on the latest user data. The engine also continuously evaluates progress and can modify the program’s future weeks (e.g., adding a deload or changing rep schemes) as the user moves along. 1. Template-first vs. Fully Algorithmic:

We choose a template-first approach for macro structure: e.g., define that a certain user will follow a 4-day push/pull/legs split with defined exercise slots (like Day1: quads, chest, triceps; Day2: back, biceps, etc.). This ensures logical consistency (it’s how human coaches plan). However, within that template, the generator algorithmically selects the best exercise variant and sets/reps based on the rules and constraints. This hybrid means the user feels like they are on a coherent program (not random workouts), yet it’s personalized. The template can be seen as a “skeleton,” and the engine puts flesh on it each week. 2. Inputs to the Generator:

User profile data (goals, schedule, equipment, exclusions, any specific requests).

The chosen base Program template (which provides a blueprint of workout structure).

The current state: this includes the user’s latest performance metrics (1RMs or rep records for exercises), fatigue/recovery status, and progress status in the current program (what week/day we’re on, any recent deviations).

Historical adherence: if user missed last workout, input that so generator might carry over something or reduce progression.

Feedback: the user’s difficulty ratings or RPE logs feed in; e.g., if last squat session RPE was very high, generator might tread lightly on squats this time.

3. Constraint Solving Approach:

We define both hard constraints (must not be violated) and soft constraints (preferences to satisfy if possible):

Hard constraints:

Equipment: Only use exercises user has equipment for.

Muscle group spacing: If an exercise heavily works a muscle group that is < X% recovered (e.g., <50%), avoid scheduling it (or if scheduled by template, replace with a lighter variant).

Time: Total sets * average set time + rest should roughly equal desired session length. The generator may cut some accessory sets if running over time.

Balance primary movement patterns: If template says today is push-focused, don’t accidentally also include many pull exercises (unless it’s intended).

Safety: Avoid giant jumps in volume or intensity from one session to next (e.g., limit increase in weight on a lift to maybe 5-10% unless prior weight was trivially low).

Soft constraints:

User dislikes: If user marked “never burpees,” don’t include burpees (we treat that effectively as a hard constraint of exclusion).

User exercise preferences: If user said they prefer barbells to machines, lean towards barbell exercises when choices exist (if equally effective).

Novelty vs consistency: Some variety is desired but not too much; maybe a soft rule “do not repeat the exact same accessory exercises more than 4 weeks in a row” – the engine could swap after that.

Even muscle development: Soft constraint to not let any muscle group lag far behind (especially for general goal users). If the template inadvertently is missing direct work for, say, biceps, the engine might slip in some curls occasionally.

Minimize equipment switches within a workout: If possible, group exercises so user isn’t running around the gym. E.g., if template had two barbell lifts and two dumbbell lifts, maybe do barbell ones first then dumbbell, to reduce switching. This could be a minor optimization the algorithm checks when ordering.

We can implement constraint solving in a straightforward greedy algorithm: iterate through the planned exercises for the day (as per template slots) and assign an actual exercise and load that fits constraints, adjusting if needed. For example, template says “Quad dominant compound” on Day1 – normally that’s Barbell Squat. But user’s profile says bad knees or no barbell – the engine will choose e.g. Goblet Squat or Leg Press, whichever is available and appropriate for level. It checks recovery: if quads are still very sore, maybe it switches the day’s focus (this might be more complex, possibly swap Day1 with Day2 if one muscle is too fatigued – that’s an adaptive schedule reordering, which we can do if user allowed flexible schedule). 4. Progression Algorithms Employed:

We will use:

Linear progression for novices on foundational lifts: increase weight by a small fixed amount each successful session. (We’ll track whether last session was “successful” – e.g., all prescribed reps achieved with good form, no excessive RPE. If yes, progress; if no, either repeat or deload.)

Double progression for hypertrophy accessories: e.g., if an accessory lift is 3×10-15 range, we keep weight until the user hits 3×15, then raise weight and reset to 3×10 at new weight. The engine will look at logs: if last two sessions at 50 lbs for curls yielded 12,12,11 reps, we’re not at top yet – continue. Once 15,15,15 achieved, it will output next session’s plan as e.g. 55 lbs for 3×10.

RPE-based for big lifts (advanced only): If user is advanced or explicitly using RPE mode, the engine doesn’t fix a weight ahead of time but rather says “work up to top set @ RPE 8 for 5 reps”. But it might give a suggested target based on last time (like last time you did about 200 lbs @ RPE8, so aim around 205, but adjust by feel). The engine in that case is generating a target intensity range rather than exact. For back-off sets, Juggernaut uses formulas like “drop 5% for 2 more sets” – our engine can incorporate such rules.

Weekly volume progression: We might programmatically increase sets or add an exercise if needed. E.g., if goal is hypertrophy and user is handling current volume easily (low RPEs, good recovery), the engine might add another set to key exercises in the next microcycle, up to a limit. Conversely, if user is struggling, it might reduce sets temporarily.

Deload logic: The engine monitors accumulated fatigue. If a scheduled deload week is in the template, it will implement it (like all weights at 50% and maybe fewer sets). If no scheduled one but the user shows fatigue (multiple poor performances or recovery scores down), the engine can insert an unscheduled deload: e.g., override the next week to be lighter and inform the user. Or at least lighten the next couple sessions.

5. Weekly Structure & Periodization:

The engine will generate one microcycle (typically a week) at a time. It could generate the whole program upfront, but we prefer dynamic generation so it can adapt. Possibly, it generates a week or two ahead so the user can see upcoming workouts (some like to know what’s coming), but with note that it may adapt. Implementation could fill the calendar for, say, 2 weeks, and after each workout or week, adjust the following ones if needed (this requires updating those ScheduledWorkouts). We incorporate periodization by having templates possibly divided into phases (heavy vs volume focus, etc.). For example, a 12-week strength program might have 3 phases: high volume, intensity, then peaking. The template contains that logic broadly (like rep schemes change each phase). The engine ensures progression within each phase (like gradually increasing weight each week during volume phase), and then transitions. 6. Exercise Rotation:

Every X weeks (maybe 6-8 weeks for intermediate, 12+ for advanced, and not until 12+ for novice), the engine can rotate accessory exercises. We maintain a pool of substitutes for each slot. For main lifts, we might keep them longer for specificity, but even advanced lifters might rotate variations (box squats vs regular squats etc.). The data model linking exercises by category helps: e.g., the category “vertical pull” could have pull-ups, lat pulldown, etc. If user plateaued on pull-ups, swap to lat pulldowns for a cycle. The engine might do this automatically at end of a cycle, or if it detects repeated stagnation on an exercise. 7. Substitution Logic (during generation and live):

As mentioned, if an exercise in template is not suitable (equipment/injury), pick another from same category. Also, if the user hits “swap exercise” in-app (some apps allow you to swap on the fly, e.g., if machine is occupied), we’ll fetch a recommended substitute (similar muscle & difficulty). For consistency, we could plan multiple options ahead of time: e.g., each workout template could carry a ranked list of alternate exercises for each slot so that generator or user can pick alternates easily. 8. Safety Bounds Implementation:

We build checks:

Weight jump check: if due to progression rules the next weight comes out >10% higher than last, cap it (and perhaps increase reps instead if needing progression).

Volume spike check: if user missed a workout and we combine it with next, ensure total sets not double beyond usual.

If user is returning after a break (detected gap of >2 weeks), the engine will scale down intensity for first session back (perhaps by 1-2 weeks regression).

The engine should also not push intensity if form might be an issue: e.g., novices maybe have a cap like don’t go above 90% 1RM without many weeks of prep.

Engine Recommendation:

Given all above, our recommended engine is a rules-based system with a templated backbone. This approach is transparent, easier to QA (we can reason through the rules), and flexible enough to incorporate new rules as we learn from usage. It avoids the need for complex ML initially, though we can later augment it with data-driven tuning (e.g., use aggregated user data to refine how much to increase weight when RPE is a certain value, etc., essentially fine-tuning rules). Example of Engine Flow for one workout generation:

Let's say Intermediate Ivan has an Upper Body Day scheduled:

Template says: 1) Bench Press 3x5 heavy, 2) Row 3x8, 3) Overhead Press 3x8, 4) Lat Pulldown 3x10, 5) Biceps iso 2x12.

Engine input: Ivan’s last Bench was 100kg 5x5 (estimated 1RM ~115kg), he completed all sets at RPE9 on last set; his triceps were a bit sore today (just as example), Whoop recovery 70%.

The engine goes slot by slot:

Bench Press: It's a main lift. Rule: if last bench was successful but RPE high, increase small. So maybe suggest 102.5kg 3x5. That’s +2.5%, within safe range. Check recovery: chest/triceps slightly sore but >= moderate (70% recovery overall). It's fine. Constraint check equipment: he has barbell, yes. So choose Barbell Bench Press with 102.5kg for 3x5.

Row: Could be Barbell Bent-over Row as template default. But maybe user doesn’t have a good setup or indicated preference for cable row. Also maybe his lower back was taxed by yesterday’s deadlifts (if schedule had deadlift day prior). The engine might decide to use a Chest-supported row machine to spare lower back. So it swaps exercise to “Seated Cable Row” 3x8. What weight? If he did say Dumbbell rows 30kg for 8 last time, engine might guess a starting weight on cable – maybe 60kg. This might be trial-and-error at first or based on ratio data from population. We might also list it at RPE8 target.

Overhead Press: Template says barbell overhead. Check equipment and user performance: user’s OHP has plateaued maybe. If we know, perhaps try Dumbbell Shoulder Press this cycle for variety. The engine picks that. Weight: from last logs of DB press or an estimate (maybe he did 20kg dumbbells for 10 before; now 3x8 maybe with 22kg).

Lat Pulldown: user has that machine, fine. If he had no machine, we’d swap to pull-ups (assisted if needed). Weight (or assistance) chosen based on last time (if he did 10 reps at bodyweight -30kg assist, adjust etc.).

Biceps iso: template doesn’t care which curl. The engine might rotate between dumbbell curls, barbell curls, etc., every few weeks for fun. Suppose last time was Barbell Curl, do Dumbbell Hammer Curls today 2x12. Weight from last DB curl log or start conservative if none.

After generation, the workout is built. It meets constraints (time ~ maybe 60 min, which is his target, exercises all available). If his triceps were extremely sore, maybe engine would have skipped direct tricep work or reduced bench intensity, but in this scenario it’s fine.

This workout is presented to Ivan. During execution, if Ivan says “bench station is busy, swap it”, the app could suggest “Dumbbell Bench Press with 2x 45kg for 5 reps” as a on-the-fly substitution (this uses same logic but in realtime, preserving that it’s a horizontal push compound, matching intensity as closely as possible). The log would note the substitution happened.

The above demonstrates a rule-based approach that uses the template as a scaffold and responds to the user’s data. We would test these rules extensively and refine them with real user feedback to ensure the engine’s recommendations feel sensible and “coach-like.”

### E. Logging Workflow and UX

Now we detail the user experience and workflow while logging workouts, aiming for minimal friction and robust features. This covers what the user sees and does from the moment they start a workout to when they finish or need to modify it. Starting a Workout:

The user opens the app and sees either today’s planned workout (if one is scheduled) or a prompt like “It’s a rest day. Start an unscheduled workout?” if nothing planned. Assuming it’s a workout day – the app prominently shows “Today: Workout 5 – Upper Body” with a summary of exercises. The user taps “Start Workout.” This transitions into Workout Mode: a focused screen optimized for in-gym use.

Workout Mode UI:

At the top, show the workout name or type and maybe an elapsed time counter (small).

Then a list of exercises in order. Each exercise can be in a collapsible panel with its sets. For example: 1. Barbell Bench Press – 3 sets × 5 reps @ 102.5 kg

Set 1: [102.5] kg × [5] reps – [Log]

Set 2: [102.5] kg × [5] reps – [Log]

Set 3: [102.5] kg × [5+] reps – [Log] (Here maybe the third set indicates “5+” meaning do extra if possible, or maybe not – depends on program style.)

The weight and reps fields are editable. Initially they are filled with the target values from the plan. If using %1RM, it’s already computed. If using RPE target, it might show “(Aim RPE 8)” and weight field blank until user chooses.

The user typically leaves them as-is if they plan to do exactly that. They begin the set, then hit [Log] button for set 1 when done.

Logging a Set:

If they achieved the planned reps, one tap logs it. The set entry might then show a checkmark or something. The rest timer pops up immediately (“Rest 2:00” counting down).

If they did a different number of reps or had to change weight, they tap the fields to adjust before hitting Log. For example, if only got 4 reps, they change the “5” to “4” then hit Log. Or if they had to use 100 kg because 102.5 wasn’t feasible, adjust then log.

We could also allow adjustment after logging via an edit function if needed (in case they logged first then realized they should note something).

During rest, the user can scroll or pre-fill next sets if desired (some users pre-log all planned sets at once if they know they’ll complete them – but that’s risky if they end up failing; still, we could allow it for speed).

The rest timer runs in background if user leaves the app or screen locks, and notifies at 0.

Handling Special Sets:

If superset: the UI groups two exercises. E.g., “Superset A1: Bench, A2: Row”. It might present as:

Set 1: Bench [log], Row [log], then rest.

Here logging both triggers one rest timer after both are logged. Or perhaps the app expects you to do one, hit log, do next, hit log (with minimal rest between as superset implies). We should support marking them done nearly back-to-back.

If a circuit of 3+, similarly, we might have a mode where the user hits “Next” through each in the circuit then one rest at end.

Drop set: If the program says drop set on last set, we could automatically create another set entry with lower weight once they log the main set, or instruct “reduce weight by 20% and do another set” and let user log that manually as an extra set.

Live Adjustments:

Adding a Set: If user feels like doing an extra set (maybe they felt good or missed target reps and want to retry), they should be able to hit “+ Add set” under an exercise. This creates a new set entry (maybe prefilled with same weight) they can then log.

Removing/Skipping a Set: If user decides to skip (maybe they're short on time or something hurts), they can either leave it unlogged and later end the workout (app will know it wasn’t done), or explicitly mark “skip”. Perhaps a skip button next to each set or exercise. If they skip, we might grey it out and move on (and the system records a skip event).

Swap Exercise: Provide a swap function at exercise level. If they tap swap (perhaps in a “…” menu by the exercise name), a dialog suggests alternate exercises (based on our substitution logic). The user picks one, e.g., incline dumbbell press instead of bench. The UI then replaces exercise 1’s name to “Incline DB Press” and updates set targets accordingly (maybe weight suggestions too if possible). The log will then record that exercise. We likely tag that substitution internally (so the system knows originally bench was planned but swapped – could be useful info for algorithm).

Editing Past Sets: Maybe the user logged something wrong for set 1 and noticed during set 2. They should tap set 1 entry, edit the values, and save. We’ll update the log data. If the edit was, say, increasing weight because they accidentally had logged lighter, we might recalc 1RM immediately, but perhaps better to just recalc at end.

Logging RPE/Notes: For advanced tracking, each set (or at least each exercise) could have an optional field to input RPE or notes (“rep 4 was a grind” etc.). Some apps do set-level RPE. We can allow user to long-press or tap a small icon on the set to bring up RPE selector (1-10 scale) and maybe a text note. Or simpler, ask RPE only on top sets. The data model can store it. This is more for advanced users, but including it doesn’t clutter if we hide it behind an icon.

Pausing and Resuming:

If user leaves workout mode (to answer a text, etc.), the app should keep the state. If they come back later (same day), it picks up where they left. If the app closed, it should remember the in-progress workout (maybe store partially logged sets).

If they need to end early, they could hit “Finish” mid-workout. The app might say “You have 2 exercises left, finish anyway?” If yes, it finalizes the log with what’s done, marks remaining as missed. If no, they resume.

Finishing a Workout:

The user hits “Finish Workout” when done (or the app auto-senses all sets logged and suggests finish). A confirmation ensures they didn’t forget anything.

Immediately, show the Workout Summary:

Possibly calories burned (if integrated with heart rate, or a rough METs estimate – nice for general users).

Total volume lifted (tonnage).

Any PRs achieved: e.g., “New 5 rep max on Bench: 102.5 kg! 🎉” or “Highest volume leg day this month.”

If available, “Recovery used: you started with 70% recovery, now strain from this workout is X” (if integrated with Whoop or if we compute TRIMP or something).

A prompt for feedback: e.g., “How did this session feel overall?” with options or a slider. Or a question if something was off (“We noticed you skipped deadlifts – any reason?” with some quick choices like injury, lack time, etc., which could inform future).

Possibly a note: “Next workout: Monday – Squat focus” to remind them.

This summary reinforces achievements and also collects feedback that our engine will use.

Post-Workout Logging Integrity:

All the logged sets are now stored in the WorkoutLog. If any planned sets were unlogged (skipped), we mark them in the log as skipped or just absent. The system, when analyzing, could treat skipped sets as zero reps events (to differentiate from not attempted vs completed with certain weight).

If user gave feedback (like “too easy”), that is stored tied to that workout.

The program progression logic then kicks in to use these results for generating the next workouts. For instance, because Ivan logged bench 102.5 5,5,5 at RPE 9, the engine knows to maybe try 105 next time or add a rep, etc. If he had logged RPE 10 (failure on last rep), engine might keep weight same next time or slight deload.

Corner Cases:

Partial workouts next day: If a user accidentally didn’t finish and left it open, we might allow them to continue the next day. But ideally, if it crosses day boundary, better to finalize and adjust program. We’ll probably encourage finishing or formally ending session on same day.

Offline logging: If our app uses a cloud sync, ensure logging works offline and syncs later (should be fine, as logs can be locally stored then uploaded).

Multiple workouts in a day: Rare but possible (some do two-a-days). Our UI can handle one at a time. After finishing one, they can manually start another (maybe a button “Start Additional Workout”).

Auto-advance vs manual: Some apps automatically jump to next set when timer ends. We can consider an option to auto-prompt “Start next set now?”.

Workouts without a plan (Free style): If user chooses to do something not on their program (like Tom’s quick workout), we should allow them to open a “New Workout” where they can add exercises ad hoc:

Perhaps provide a quick picker to add exercise, set, reps, weight and log. Or an on-the-fly circuit builder. This freeform workout is logged and saved. The program might ignore it or treat as extra credit (maybe update fatigue).

We likely treat unscheduled workouts as separate entries that don’t affect the main program schedule except via fatigue adjustments.

The guiding principle is to make logging faster than using a notebook, capturing all useful data reliably, and accommodating deviations easily. By implementing the above, we cover everything from straightforward logging to complex modifications, ensuring data quality for the analytics and engine to use.

### F. Analytics and Review Features

This section describes what data we track and how we present it to the user in meaningful ways, as well as the “review” workflows (e.g., weekly summary, progress review screens). The goal is to give users insight like a coach would, without misinforming. Tracked Metrics (and Why):

Performance Metrics: For each major exercise, track best lifts (max weight for various rep counts) and estimated 1RM. This is crucial for strength progress. We’ll continuously update estimated 1RM from workout logs using a formula (e.g., Brzycki: weight * (1 + reps/30)) and if a user does an AMRAP or a heavy single, that refines it. We also track endurance performance if relevant (best mile time, etc., if we had cardio).

Training Volume: Weekly (or per-session) volume = sum of weight * reps for all sets, possibly broken down by muscle group or lift type. Volume is a proxy for workload especially in hypertrophy context. We track it to ensure progressive overload and also to avoid sudden spikes that cause fatigue.

Intensity: Could be average %1RM used per set, or something like “tonnage / total reps” to represent average weight lifted. For endurance, intensity might be pace or heart rate. This tells how heavy/hard the training is.

Frequency/Adherence: We log how many workouts completed vs planned, and frequency per muscle group (e.g., quads hit 2x/week consistently or not). Adherence is key to results, so we want to reflect that (e.g., “You’ve been 90% consistent this month”).

Fatigue & Recovery metrics: If integrated with Whoop, each day we have a Recovery score and a Day Strain. We will chart Recovery over time (with annotations of workout days) to see patterns. Even without Whoop, we might use user’s resting HR or subjective energy levels as a crude fatigue metric. We track those to correlate dips in performance or to decide deload timing.

Body metrics: If user logs weight or body fat periodically (or it syncs from a smart scale), we track that. It’s important for context (e.g., if weight is dropping due to diet, strength might plateau and that’s expected). Also for users whose goal is weight loss or muscle gain, that is a direct outcome metric.

Achievements: Count PRs, total workouts, streaks, etc. This is tracked to provide badges or milestones.

Analytics Displays: We will have a Progress/Analytics dashboard in-app with multiple sections (with user-selectable date ranges, e.g., last week, last month, 3 months):

Strength Progress Graphs: Line graphs for the big exercises (or any exercise user selects) showing estimated 1RM or max weight over time. For example, a bench press graph might show it rising from 80kg to 100kg over 6 months, maybe flattening if a plateau. We can overlay phases (like show where a deload happened or a switch in program).

Volume & Intensity Trends: A bar or line graph per week. E.g., weekly total volume (stacked by muscle group or by exercise category). If user chooses, say, “Upper Body Volume,” it shows how it changed. Intensity could be a line overlay (maybe average %1RM each week).

Muscle Group Balance: Perhaps a pie chart of volume by muscle group in the last 4 weeks. Or simply a summary that shows how many sets per muscle per week (compared to recommended ranges). If we detect imbalance, highlight it (“Legs volume is 30% lower than upper body – consider adding some leg work”).

Performance Records: A PR list – best 1RM (or 5RM, 10RM) for each lift. We can show last PR date. This motivates to beat records and also highlights if it’s been a long time since last PR on something (maybe a sign of plateau). Possibly have a separate section for cardiovascular PRs if applicable (fastest 5k, etc.).

Recovery & Wellness Trends: If user has Whoop or logs RPE, etc., we could show a chart of recovery vs. daily strain or vs. performance. For example, a timeline: each day’s recovery score and maybe a dot on days they did heavy workouts, to visualize “most of your PRs happened on green recovery days.” But careful to not overemphasize this correlation if not strong. Another idea: a trend of rolling 7-day strain vs rolling 7-day recovery, to see if they’re accumulating fatigue.

Adherence and Consistency: A calendar view perhaps, marking days with workouts done (green), planned but missed (red), rest (gray). This gives an at-a-glance compliance view. Also a stat “Workouts completed: 45 (90% of planned) in last 3 months.” If user allows, we might also show longest streak of weeks without missing a workout.

Goal-specific metrics: If user’s goal is hypertrophy, they might want to see muscle measurements (if they input them) or volume progress. If goal is weight loss, a weight chart is key (with trend line). We tailor the dashboard a bit based on goal.

Insights/Interpretation: We include short textual insights near graphs:

E.g., next to strength graph: “Bench press strength is up 15% since Jan. That’s ~5kg gain – great progress! Keep it up.”

Next to volume chart: “Your training volume has plateaued the last 2 weeks. This could be intentional (peak phase) or could indicate fatigue – ensure adequate recovery or plan a deload if needed.”

Imbalance note like earlier: “Volume distribution: 40% lower body, 60% upper body. Slight upper focus – if goal is general, ensure legs get enough work. Suggest adding 2-3 sets of squats or lunges.”

These are carefully phrased and only shown when applicable. They should be grounded in known training principles to be defensible. We would probably code these rules (like if any muscle group volume < 50% of another and goal is general or hypertrophy, show imbalance tip).

#### Weekly Review Workflow

Every week (or user-chosen interval), the app can present a summary, either via a push or when they open app:

“Weekly Summary: You completed 3/3 workouts. Volume was up 8% from last week, with biggest increase in legs (thanks to that extra set of squats). You set 2 PRs: Deadlift 5RM and 1-mile run. Recovery averaged 70% (yellow) – fairly good. For next week, aim to maintain consistency and perhaps get a bit more sleep to bump recovery into green.”

This kind of summary combines data and guidance. It’s basically automating what a coach might say in a weekly check-in. We can either show this in-app in a card or send via email if user opts in.

Coach-like Insights (Defensible):

We avoid over-hyped “AI coach” claims and stick to evidence-based insights, such as:

Identifying plateaus: “Your overhead press hasn’t improved in 6 weeks. It might be time to vary your approach. We suggest a deload or switching to dumbbell press for a cycle.” This is based on clearly observable data (flat progress).

Volume and intensity management: If volume jumped drastically: “You increased total volume by 40% this week (from 8000 kg to 11,200 kg). This is a big jump – be cautious, as too rapid an increase can lead to overtraining. If you feel unusually sore or fatigued, consider dialing back slightly next week.”

PR encouragement: “You’re 5 kg away from a milestone: 100kg bench press. Keep pushing – you’re close!”

Readiness advice: If Whoop shows several red recoveries in a row: “Your recovery scores have been low for 3 days. It's important to recover – consider an early rest day or focus on sleep.” That’s defensible as it directly uses Whoop’s intended interpretation.

Avoiding misleading metrics: We won’t create a single “fitness score” that is not transparent. If we do an overall score, we would explain it (like “Your Overall Strength Score is 80 (out of 100), which is an average of your strength levels across muscle groups.”). But likely we’ll focus on discrete metrics.

Visualization & Guidance: We will ensure each chart or number either has an explanation or is simple enough. Possibly include a “?” tooltip on metrics that gives a one-sentence explanation (“Volume = total weight lifted, used to measure training workload”). We might also include reference benchmarks or ranges. E.g., if user enters body weight and sex, we could compare their lifts to norms (like strength level standards: “Your squat is intermediate level for your bodyweight” etc.). That’s an added motivator and context (but again need good data source – perhaps something like strengthlevel.com’s data). Another part of review is letting the user review their workout logs easily. We’ll have a log history screen where they can scroll through past workouts, see what was done. Possibly filter by exercise (“show all my bench press sets over time”). This is useful for analysis or just nostalgia/motivation (“look, I started curling 10kg, now 15kg!”). In summary, analytics will turn the raw logs and imported data into user-friendly charts and summaries focusing on progress, balance, and consistency. The review workflows (weekly summary, etc.) will close the feedback loop, helping users make sense of their training and feel rewarded. We will be cautious to only highlight actionable or truly meaningful insights, avoiding any data that might mislead or overwhelm (keeping more granular stuff optional or in the background).

### G. Feature Roadmap

We will outline the development roadmap in phases: MVP (minimum viable product), followed by Version 1, and Version 2+ features. Each stage is prioritized based on delivering user value and managing complexity incrementally. MVP (Must-Have Features):

The MVP focuses on the core loop: create profile -> get workouts -> log workouts -> basic analysis, all in a stable offline-capable app.

User Profile & Onboarding: Capture goal, experience level, schedule, equipment. Choose or generate an initial program. (Basic templates included for common scenarios.) This directly yields value by giving a personalized start.

Exercise Library & Workouts: A predefined exercise database with major exercises (with images/videos). Ability to present workouts with sets/reps/weights. The generator at MVP can be simpler: e.g. rule-based but maybe not fully adaptive from day one – perhaps initially it uses a fixed linear progression plan or basic algorithm. (We’ll include at least some adaptivity, but it might be conservative initially, to be refined with data.)

Workout Logging & Timers: Core logging workflow as described – record sets, mark complete, edit, rest timer, etc. Without this, the app fails its purpose. This part needs to be very solid and intuitive (lots of polish).

Basic Progression Logic: Even in MVP, we need auto progression to show value. For example: after user logs workout, the next same workout automatically has weight increased (or reps increased) if appropriate. Also basic fatigue management: e.g., not scheduling muscle back-to-back, maybe a naive recovery calc (like 48h muscle rule).

Analytics Basics: At least show weight progress for major lifts and track PRs. Perhaps a simple weekly summary of volume or workouts done. This proves the concept and gives user feedback.

Whoop Integration (basic): Since “Whoop only” is requested, MVP should be able to connect to Whoop and retrieve daily Recovery and Strain. It doesn’t need heavy use yet, but maybe it displays today’s recovery and if it’s very low, it can notify user or tag the workout “easy” in text. The deeper integration logic can be refined later, but basic connectivity and perhaps a simple rule like “if recovery <33%, show a rest suggestion” would be included.

Offline-first Data Storage: MVP will store everything on device (SQLite or similar). No mandatory login. Possibly implement an export as backup (even if manual). This is critical for user trust and usability in gym (which often has poor signal).

UI Polish for Primary Flows: The main screens (dashboard with today’s workout, workout logging screen, profile) must be polished and user-friendly. MVP does not require fancy visuals or deep settings pages, but core ones must be good.

Privacy & Permissions: Get Whoop permission properly, have a Privacy Policy, etc. Also ensure no data leaks (MVP being offline helps).

Platform: Likely launch on one platform first (maybe iOS given many gym-goers on iPhone, or Android if that’s our target). Cross-platform can be V1.

Feedback mechanism: MVP should include a way for users to give feedback (maybe a simple “Report issue” or short survey about accuracy) – this will help refine later versions, though it's an internal detail.

Value of MVP: It allows a user to start training with a plan and track it easily, which is a big step up from pen-and-paper. It demonstrates the concept and collects initial user data to improve the engine. Even if adaptivity is basic, users get something personalized to their equipment and goal (like Fitbod’s early version perhaps). We’d likely test MVP with a small group to ensure the workouts make sense and logging is frictionless before public release. V1 (Next Version Features):

These are enhancements once basic viability and feedback from MVP are in:

Enhanced Adaptive Engine: Incorporate more sophisticated adaptation rules as planned (dynamic RPE adjustments, more granular muscle fatigue tracking, auto-deload suggestions). By V1, we want the selling point of “adjusts like a personal trainer” to really shine. This might use the data collected in MVP to tune algorithms.

Expanded Program Templates: Add more built-in programs or templates covering more goals: e.g., a powerlifting-focused template, a half-marathon training add-on, a CrossFit-ish conditioning template, etc. Also introduce the concept of phases or cycles more formally (so user can embark on a 12-week cycle).

Custom Routine Builder: Allow users to create or modify their program templates directly in-app (especially for advanced users). For instance, Alice could edit her plan for the week, or a user could design a new 4-week block and then let the app take over progression. This adds technical complexity in UI but high value for advanced segment.

Social Sharing & Import: Not full social features, but ability to share your PR or weekly summary image externally (to Instagram, etc.). Also perhaps import a program from a spreadsheet or from LiftVault if possible (like if they have a CSV, the app could try to ingest it).

Apple Health & Others Integration: In V1, expand beyond Whoop: sync workouts to Apple Health, pull in bodyweight or other metrics from HealthKit or Google Fit. This broadens appeal and data completeness.

Wearable Live Data: If feasible, link to Apple Watch or similar to get heart rate during workouts (could auto-detect rest end if HR recovers, just ideas) and track calorie burn more accurately. Not crucial, but nice addition in V1 to attract more casual fitness folks who like calorie counting.

Nutrition Logging (light): Not to plan diet, but maybe allow user to log protein intake or sync MyFitnessPal daily summary just to display alongside recovery. This is low priority and only if user demand indicates.

Community/Challenges (light): Possibly add some challenges like “Complete 10 workouts this month” with a badge, or a leaderboard if we have enough users (like how Peloton has monthly challenges). This is more engagement feature – not core, but can improve retention.

Cloud Sync & Multi-Device: If not in MVP, by V1 we implement a cloud account where users can log in on a new phone and retrieve data. Could use our own server or integrate with something like iCloud for iOS. Also allows if they switch from phone to tablet or get a new device.

Coach Mode (maybe): Not a full marketplace, but maybe allow a user to “export my data for my coach” or a coach to design a program and send to user’s app. This might be too early at V1 unless we see demand from personal trainers wanting to use the app’s logging with their own clients.

Refinements based on MVP feedback: For example, if users said the UI for logging superset is confusing, fix that. Or if some algorithm choices were off (maybe the starting weights needed calibration), adjust those. V1 is where we iterate and polish.

#### V2+ (Advanced / Future Ideas)

Big, possibly transformative features once we have a solid user base and data:

Machine Learning Recommendations: With sufficient logs, we could attempt ML to find patterns, e.g., predict plateaus or optimal progression for an individual. Could use collaborative filtering (“users like you struggled at week 8, so do X”). Also ML for form analysis if we input videos, etc., but that’s likely out of scope.

Form Tracking via Camera or Sensors: Perhaps integrate with camera or AR to count reps or check form angles. There are experimental apps that do this. Not essential, but could be a differentiator for a later version if tech matures.

Auto-Regulate via Wearable Data: For instance, use live heart rate or bar velocity (if integrated with a device) to adjust workout in real-time. E.g., velocity-based training for advanced lifters – if their bar speed is slow, cut the set. This is niche but possible future direction.

Group and Social Workouts: If we have social features, could allow friends to compare or do a “group program” challenge together.

Marketplace for Programs: Maybe open up community sharing of programs or selling by coaches. This competes with some existing stuff, but if our platform is robust, it could be an avenue (though not initial goal).

Integration with Gyms or Equipment: For example, connect to smart gym equipment or gym information (like see if squat rack is free – far-fetched but could partner with smart gyms).

Gamification and VR: In a distant future, might incorporate AR/VR workouts (for home users perhaps), or deeper gamification like leveling up your profile RPG-style (some apps have done things like that to motivate).

Nutrition Coaching: If at some point we integrate diet and workout for a full “personal trainer” experience. Possibly adding an AI meal plan generator or at least diet tracking and linking it to performance (TrueCoach added an AI meal plan generator for trainers, which shows interest in that domain).

We prioritize these later features by user value and complexity:

Something like ML recommendations depends on having data – so not before V2 realistically.

Social/community could add value via motivation, but we’d gauge if our user base is asking for it.

Nutrition integration, while valuable (since fitness and diet go hand in hand), is a deep area on its own, so might partner or integrate with existing apps rather than build from scratch.

If focusing on being the best training app, we might deliberately not do nutrition or heavy social until we dominate the training aspect to avoid losing focus (as stated in non-goals).

Rationale Recap:

MVP is about proving the concept works and solving the immediate problem (no-fuss personalized workouts & logging). V1 builds on feedback to make the system truly adaptive and comprehensive enough for serious enthusiasts (so they stick around). V2 and beyond expands scope or introduces cutting-edge capabilities to stay ahead of competitors and possibly broaden market (like adding nutrition might broaden to weight-loss market). We will remain user-centric in this roadmap: each feature is tied to either increasing user results, improving user experience, or retaining users. For example, cloud sync is purely UX (safety of data), whereas adaptive engine improvements directly improve results, and challenges/social improve retention. Balancing these ensures the app grows in a healthy way.

### H. Tooling and Implementation

Finally, we consider the technical implementation details and architectural patterns for the system, including how we handle data storage (offline vs server), syncing, integration with third-party APIs (Whoop, HealthKit), and ensuring privacy and observability. Architecture Approach:

We’ll likely build a mobile app (initially iOS, later Android). The core logic (workout generation, progression rules) can be implemented in the app (ensuring offline functionality), possibly in a shared code module if doing cross-platform (like using React Native or Flutter, or sharing logic in a Rust or C++ library). We will use a small backend server primarily for account sync and storing user data backups, not for core logic (at least at first). This means the app will work offline for all main features and just sync data to cloud when possible – an offline-first approach. Storage Patterns:

On-device Database: We’ll use an embedded database (SQLite via an ORM or similar) to store exercises, workouts, logs. This gives fast access and offline capability. All entities described in Data Model will have tables (Exercises, WorkoutTemplates, WorkoutLogs, etc.).

Cloud Sync: When user creates an account or opts to backup, we sync their data to our server (which could be a simple REST API with a database). We have to do conflict resolution if multi-device: a last-write-wins might suffice if we assume one active device mostly. If a user logs workouts on two devices offline, sync conflicts could occur – we might choose to discourage simultaneous use, or implement merging (which is complex but doable: e.g., if two different workouts were logged, we keep both; if the same scheduled workout was logged differently on two devices, that’s tricky – we could treat one as edited after fact or create two logs).

Data Volume: Not huge – workout logs are small text/numbers. So local storage is fine. Sync payloads are small too (a year of workouts might be a few thousand records, which is negligible).

Backups: Perhaps integrate with device backup (iCloud backup or manual export) for paranoid users. Also version the database schema carefully for app updates.

Sync/Conflict Resolution:

Use unique IDs (UUIDs) for all records so merging doesn’t duplicate things. If user uses offline then online, the server can merge new records in.

If a workout log on server is edited on device (like user edited yesterday’s log offline), we need to update – maybe each record has a lastModified timestamp to compare.

Scheduled workouts might get updated by generator (like when adapting future plan). If an offline device doesn’t get the update, it’s minor (the user might just follow a slightly outdated plan). We can, upon reconnection, either accept the server’s latest version of future workouts or ask the user if major conflict. Since future plan is dynamic, it might be simpler to always regenerate future on one “authoritative” device. Honestly, easiest is to assume single device usage for now, and treat multi-device as sequential (like if you switch phone, you login and resume, not use both concurrently).

Integration Options (Whoop/HealthKit/etc.):

Whoop API: We’ll register an API application with Whoop. User would authenticate (OAuth) to give us access to their data. We retrieve at least daily metrics: recovery, sleep, strain. Possibly also workout heart rate data if we want to associate with our logs (Whoop can track activities, but if user uses our app to log, we might push an activity to Whoop or at least link them by time).

We need background fetch to get fresh Whoop data each morning for Recovery. Could be done client-side (app calls Whoop API) or via our server acting as proxy (storing tokens and pulling data server-side, then app fetches from our server). For simplicity and privacy, doing it client-side might be fine (the app can call Whoop directly with the token, unless Whoop disallows that).

Apple Health / Google Fit:

Apple HealthKit integration (on iOS): We’d request permissions to read (weight, maybe sleep, other workouts) and write (log our workouts to HealthKit). This keeps the user’s data holistic – e.g., their run from Strava appears in Health, our app can see it. Fitbod does similar. Implementation: use HealthKit APIs to get relevant samples daily or in real-time.

Google Fit similar approach on Android.

These need careful handling: e.g., deduping if user logs same workout in two places, etc. But for MVP likely just Whoop; V1 for Apple Health more thoroughly.

APIs for others: Could integrate with Strava’s API to pull in runs/bike rides if needed (though if in HealthKit, that covers iOS users; for Android maybe integrate Strava directly or accept manual input).

Device integration: Apple Watch app could be another product – not strictly needed but if we did, it might mirror workout logging on the watch or just record HR. That’s a separate effort that might come in V1 or V2.

Privacy & Security Implementation:

Personal Data: We minimize collection. For account creation, email + password is enough (no need for full name or address). All health data we store, we treat as sensitive: encryption at rest on server (DB encryption for fields like weight? Possibly, though not legally required like PHI since we’re not a covered entity, but good practice).

In-App Privacy Controls: Let user easily see what data is synced. Perhaps a toggle “Store my data in cloud” – if off, then purely local. If on, data goes to server. At least they should know either way.

Encryption: Use HTTPS for all API calls. If storing any tokens (Whoop, HealthKit doesn’t need token but Whoop does), encrypt them in storage. The local DB can be encrypted as well (SQLite with SQLCipher) to protect data if someone unauthorized accesses the phone (though phone’s whole storage might be encrypted by OS anyway if locked).

User Authentication: Standard email/password, possibly allow OAuth through Google/Apple sign-in to simplify (less password management).

Permissions and Compliance: We clearly ask for HealthKit permission (Apple requires showing purpose string). For Whoop, their API might have user scopes and a user agreement we need to adhere to. We’ll have a privacy policy explaining data usage (like “We use your Whoop data to adjust your training recommendations; it is stored on your device [or server if needed] securely.”).

We ensure we don’t share user data with third parties except the ones they connect (like if user links Strava, we use it only for that feature).

Observability & Logging (for us):

We want to log app events (anonymized or user-consented) to improve the system. For example, log how often users swap exercises, or how many stick with the program 4+ weeks, or which suggestions are often overridden. This will tell us where the engine might need tweaking or where users get frustrated.

Implementation: could have the app send telemetry (with user’s opt-in ideally) such as “user X skipped 2 of last 5 workouts” or “suggested weight vs logged weight difference for exercise Y”. This data helps refine algorithms (maybe we suggested too heavy weights if users often reduce them).

Crash logs: integrate something like Sentry or Firebase Crashlytics to catch errors in the wild.

Analytics: we can use something like Mixpanel or Firebase Analytics to track feature usage (e.g., how many view the analytics screen, how many adjust their schedule, etc.). Always mindful of not logging actual sensitive values. For instance, we care that user pressed “too hard” feedback, but we don’t need to log their actual weight lifted to our analytics, just the pattern.

If any server component, also instrument that for performance and errors.

Tech Stack Considerations:

We might choose a cross-platform framework like Flutter to build both iOS and Android faster. It can handle complex UI (graphing, etc.). Flutter has packages for Health APIs too.

If native, iOS Swift and Android Kotlin. The generation engine could be written in a shared language like Kotlin multiplatform or Swift cross compile – but that might be overkill. Simpler: implement logic twice or use C++ for core logic compiled for both.

Backend likely Node.js or Python with a small Postgres DB, if using our own. If user base grows, we design for scalability (but fitness apps are not crazy in data – even with millions of users, the data per user is small).

Testing Strategy:

We will need to verify the generator logic thoroughly with unit tests (simulate different profiles and ensure workouts make sense, no constraints violated).

Also test the adaptation – e.g., simulate a user log of failing reps and see if system adjusts next workout accordingly.

UI testing for logging flow to ensure no bugs like set deletion issues.

With wearable integration, test with sample data (like an average Whoop user pattern) to see that our suggestions align logically.

Security Extras:

If storing any credentials (like Whoop API secret), do that securely (keystore on Android, keychain on iOS).

Possibly allow local app lock (some want to lock fitness apps since it has personal info – maybe low priority).

Ensure our servers (if any) secure (harden endpoints, use token auth).

In summary, the implementation will lean on an offline-first, client-heavy architecture with optional cloud sync. This ensures reliability (no dependency on network for core function) and privacy (user holds their data). Integration with wearables and health platforms will extend capability but is done with user permission. We’ll uphold security best practices to maintain trust (since trust is huge for a personal health app). Observing usage data (with consent) will be key to iteratively improving the system’s intelligence and UX, making our personal training system smarter over time.

---

## Sources

Fitbod – Meet The Fitbod Algorithm (Fitbod Blog)

Fitbod – How Fitbod Creates Your Workout (Help Center)

Fitbod – How Fitbod’s AI Knows When You Should Lift Heavier (Fitbod Blog)

JuggernautAI – App Review after 120 Days (user blog review)

JuggernautAI – App Review (continuation)

Strong App – Official Features Page

JEFIT – Official Website (“Workout Planner”)

LiftVault – Free Programs & Spreadsheets (site homepage)

TrueCoach – Features Overview

Whoop Developer – API Docs (Strain/Recovery info)

Beyond the Whiteboard (BTWB) – Review on GarageGymReviews

LiftLog (Open-source app) – Developer’s comments on design

Citations

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [How Fitbod’s AI Knows Exactly When You Should Lift Heavier And When To Recover – Fitbod](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [Juggernaut AI Program and App Review after 120 Days – Makeup and Skincare Reviews](https://liftbakelove.com/2022/05/01/juggernaut-ai-program-review-120-days-progress/)

- [Juggernaut AI Program and App Review after 120 Days – Makeup and Skincare Reviews](https://liftbakelove.com/2022/05/01/juggernaut-ai-program-review-120-days-progress/)

- [Juggernaut AI Program and App Review after 120 Days – Makeup and Skincare Reviews](https://liftbakelove.com/2022/05/01/juggernaut-ai-program-review-120-days-progress/)

- [Juggernaut AI Program and App Review after 120 Days – Makeup and Skincare Reviews](https://liftbakelove.com/2022/05/01/juggernaut-ai-program-review-120-days-progress/)

- [Juggernaut AI Program and App Review after 120 Days – Makeup and Skincare Reviews](https://liftbakelove.com/2022/05/01/juggernaut-ai-program-review-120-days-progress/)

- [Juggernaut AI Program and App Review after 120 Days – Makeup and Skincare Reviews](https://liftbakelove.com/2022/05/01/juggernaut-ai-program-review-120-days-progress/)

- [Juggernaut AI Program and App Review after 120 Days – Makeup and Skincare Reviews](https://liftbakelove.com/2022/05/01/juggernaut-ai-program-review-120-days-progress/)

- [Juggernaut AI Program and App Review after 120 Days – Makeup and Skincare Reviews](https://liftbakelove.com/2022/05/01/juggernaut-ai-program-review-120-days-progress/)

- [Juggernaut AI Program and App Review after 120 Days – Makeup and Skincare Reviews](https://liftbakelove.com/2022/05/01/juggernaut-ai-program-review-120-days-progress/)

- [Your Ultimate Workout Planner & Tracking App for Progress - JEFIT](https://www.jefit.com/use-case/workout-planner)

- [Your Ultimate Workout Planner & Tracking App for Progress - JEFIT](https://www.jefit.com/use-case/workout-planner)

- [Your Ultimate Workout Planner & Tracking App for Progress - JEFIT](https://www.jefit.com/use-case/workout-planner)

- [Your Ultimate Workout Planner & Tracking App for Progress - JEFIT](https://www.jefit.com/use-case/workout-planner)

- [Your Ultimate Workout Planner & Tracking App for Progress - JEFIT](https://www.jefit.com/use-case/workout-planner)

- [Your Ultimate Workout Planner & Tracking App for Progress - JEFIT](https://www.jefit.com/use-case/workout-planner)

- [Your Ultimate Workout Planner & Tracking App for Progress - JEFIT](https://www.jefit.com/use-case/workout-planner)

- [Your Ultimate Workout Planner & Tracking App for Progress - JEFIT](https://www.jefit.com/use-case/workout-planner)

- [Your Ultimate Workout Planner & Tracking App for Progress - JEFIT](https://www.jefit.com/use-case/workout-planner)

- [Has anyone here switched from JeFit and why? : r/Hevy - Reddit](https://www.reddit.com/r/Hevy/comments/sldjjk/has_anyone_here_switched_from_jefit_and_why/)

- [Your Ultimate Workout Planner & Tracking App for Progress - JEFIT](https://www.jefit.com/use-case/workout-planner)

- [Strong - Workout Tracker & Gym Log](https://www.strong.app/)

- [Programs | TrueCoach Help Center](http://help.truecoach.co/en/articles/3047401-programs)

- [The Complete Guide to Using TrueCoach Features for Better Training and Business Growth  - TrueCoach](https://truecoach.co/learning-resources/the-complete-guide-to-using-truecoach-features-for-better-training-and-business-growth/)

- [The Complete Guide to Using TrueCoach Features for Better Training and Business Growth  - TrueCoach](https://truecoach.co/learning-resources/the-complete-guide-to-using-truecoach-features-for-better-training-and-business-growth/)

- [The Complete Guide to Using TrueCoach Features for Better Training and Business Growth  - TrueCoach](https://truecoach.co/learning-resources/the-complete-guide-to-using-truecoach-features-for-better-training-and-business-growth/)

- [The Complete Guide to Using TrueCoach Features for Better Training and Business Growth  - TrueCoach](https://truecoach.co/learning-resources/the-complete-guide-to-using-truecoach-features-for-better-training-and-business-growth/)

- [How to Build Smarter, More Effective Workout Programs with ...](https://truecoach.co/blog/how-to-build-smarter-more-effective-workout-programs-with-truecoach/)

- [The Fastest Way to Build a Client Program in 2025 - TrueCoach](https://truecoach.co/blog/the-fastest-way-to-build-a-client-program-in-2025/)

- [The Complete Guide to Using TrueCoach Features for Better Training and Business Growth  - TrueCoach](https://truecoach.co/learning-resources/the-complete-guide-to-using-truecoach-features-for-better-training-and-business-growth/)

- [The Complete Guide to Using TrueCoach Features for Better Training and Business Growth  - TrueCoach](https://truecoach.co/learning-resources/the-complete-guide-to-using-truecoach-features-for-better-training-and-business-growth/)

- [WHOOP 101 | WHOOP for Developers](https://developer.whoop.com/docs/whoop-101/)

- [Adaptive Training Plans](https://www8.garmin.com/manuals-apac/webhelp/forerunner55/EN-SG/GUID-D765BBDD-C004-46FE-88C2-B54064941509-6432.html)

- [WHOOP Integration – Access Recovery & Strain Data via Thryve's API](https://www.thryve.health/features/connections/whoop-integration)

- [Free Workout Plans & Spreadsheets | LIFT VAULT](https://liftvault.com/)

- [Welcome to wger Workout Manager’s documentation! — wger Workout Manager 2.0 alpha documentation](https://wger.readthedocs.io/en/2.0/)

- [Welcome to wger Workout Manager’s documentation! — wger Workout Manager 2.0 alpha documentation](https://wger.readthedocs.io/en/2.0/)

- [wger-project/wger: Self hosted FLOSS fitness/workout ... - GitHub](https://github.com/wger-project/wger)

- [LiftLog - An easy to use open source gym tracking app : r/opensource](https://www.reddit.com/r/opensource/comments/17vp9pp/liftlog_an_easy_to_use_open_source_gym_tracking/)

- [LiftLog - An easy to use open source gym tracking app : r/opensource](https://www.reddit.com/r/opensource/comments/17vp9pp/liftlog_an_easy_to_use_open_source_gym_tracking/)

- [LiftLog - An easy to use open source gym tracking app : r/opensource](https://www.reddit.com/r/opensource/comments/17vp9pp/liftlog_an_easy_to_use_open_source_gym_tracking/)

- [LiftLog - The Best Open Source Workout Tracker](https://liftlog.online)

- [LiftLog - An easy to use open source gym tracking app : r/opensource](https://www.reddit.com/r/opensource/comments/17vp9pp/liftlog_an_easy_to_use_open_source_gym_tracking/)

- [LiftLog - An easy to use open source gym tracking app : r/opensource](https://www.reddit.com/r/opensource/comments/17vp9pp/liftlog_an_easy_to_use_open_source_gym_tracking/)

- [LiftLog - An easy to use open source gym tracking app : r/opensource](https://www.reddit.com/r/opensource/comments/17vp9pp/liftlog_an_easy_to_use_open_source_gym_tracking/)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [How Fitbod’s AI Knows Exactly When You Should Lift Heavier And When To Recover – Fitbod](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [How Fitbod’s AI Knows Exactly When You Should Lift Heavier And When To Recover – Fitbod](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)

- [Strong Workout Tracker Gym Log - App Store - Apple](https://apps.apple.com/us/app/strong-workout-tracker-gym-log/id464254577)

- [LiftLog - The Best Open Source Workout Tracker](https://liftlog.online)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [The Best Personalized Workout Apps For Strength Training - Fitbod](https://fitbod.me/blog/the-best-personalized-workout-apps-for-strength-training-ranked-by-real-results-2026/)

- [Garmin Race Adaptive Training Plan - How adaptive is it?](https://forums.garmin.com/outdoor-recreation/outdoor-recreation/f/fenix-7-series/349614/garmin-race-adaptive-training-plan---how-adaptive-is-it)

- [How Fitbod’s AI Knows Exactly When You Should Lift Heavier And When To Recover – Fitbod](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)

- [How Fitbod’s AI Knows Exactly When You Should Lift Heavier And When To Recover – Fitbod](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)

- [How Fitbod’s AI Knows Exactly When You Should Lift Heavier And When To Recover – Fitbod](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)

- [How Fitbod’s AI Knows Exactly When You Should Lift Heavier And When To Recover – Fitbod](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)

- [Expert-Tested: Beyond the Whiteboard Review (2026) | Garage Gym Reviews](https://www.garagegymreviews.com/beyond-the-whiteboard-review)

- [Expert-Tested: Beyond the Whiteboard Review (2026) | Garage Gym Reviews](https://www.garagegymreviews.com/beyond-the-whiteboard-review)

- [How Fitbod’s AI Knows Exactly When You Should Lift Heavier And When To Recover – Fitbod](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)

- [btwb : btwb](https://beyondthewhiteboard.com/)

- [Open source exercise list](https://github.com/exercemus/exercises)

- [How Fitbod’s AI Knows Exactly When You Should Lift Heavier And When To Recover – Fitbod](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)

- [How Fitbod’s AI Knows Exactly When You Should Lift Heavier And When To Recover – Fitbod](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)

- [Expert-Tested: Beyond the Whiteboard Review (2026) | Garage Gym Reviews](https://www.garagegymreviews.com/beyond-the-whiteboard-review)

- [Expert-Tested: Beyond the Whiteboard Review (2026) | Garage Gym Reviews](https://www.garagegymreviews.com/beyond-the-whiteboard-review)

- [What should I do if I cannot find an exercise in the database?](https://www.exercise.com/support/cant-find-exercise-in-database/)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [How Fitbod’s AI Knows Exactly When You Should Lift Heavier And When To Recover – Fitbod](https://fitbod.me/blog/how-fitbods-ai-knows-exactly-when-you-should-lift-heavier-and-when-to-recover/)

- [The Complete Guide to Using TrueCoach Features for Better Training and Business Growth  - TrueCoach](https://truecoach.co/learning-resources/the-complete-guide-to-using-truecoach-features-for-better-training-and-business-growth/)

- [How Fitbod Generates Your Personalized Workouts: Meet The Fitbod Algorithm – Fitbod](https://fitbod.me/blog/fitbod-algorithm/)

- [How Fitbod Creates Your Workout](https://fitbod.zendesk.com/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout)

- [Strong - Workout Tracker & Gym Log](https://www.strong.app/)
