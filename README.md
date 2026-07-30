# Event-Driven Simulation

An experimental real-time mechanical simulator that treats motion as continuous paths separated by physical events, rather than as a sequence of fixed physics steps.

The project begins with a simple question:

> Instead of moving an object forward a small amount and checking whether it collided, can we calculate its current path, solve when that path must first intersect something, advance directly to that event, and then construct the next path from the collision response?

The initial proof of concept is a Plinko-style simulation. Balls travel through a fixed arrangement of pegs and walls, with each future collision derived from their trajectories rather than discovered through increasingly fine timesteps.

## Core idea

A conventional real-time physics loop commonly approximates continuous motion by repeatedly advancing the world:

```text
state
  → advance by a small timestep
  → detect and resolve collisions
  → repeat
```

This project explores an event-driven alternative:

```text
current state
  → define continuous motion paths
  → solve the earliest future physical event
  → advance directly to that event
  → resolve it and construct new paths
  → repeat
```

For a freely moving ball, the path may be a ballistic trajectory under gravity. For a rotating rigid body, it may combine a ballistic centre-of-mass path with a continuous rotational path. A collision ends the current path segment and produces the initial state of the next one.

The simulation therefore pays primarily for physical events that actually occur, rather than for the distance travelled or an arbitrarily high global update rate.

## Project goals

- Prevent tunnelling by construction rather than by tuning smaller timesteps.
- Calculate the earliest valid collision along continuous motion paths.
- Advance from event to event without discarding unexplored motion between them.
- Treat unresolved motion conservatively: refine the calculation or stop, never allow an object through an interval that has not been established as collision-free.
- Keep the simulation independent from rendering, input, audio and any particular game engine.
- Expose positions, rotations, velocities and physical events for a separate frontend to render.
- Focus on bounded mechanical systems with small numbers of simple rigid bodies and known collision geometry.
- Remain suitable for real-time interactive use on current consumer hardware.

## Initial scope: Plinko

Plinko provides the smallest useful test of the model:

- moving balls;
- fixed circular or cylindrical pegs;
- walls and angled surfaces;
- gravity;
- elastic and frictional collision response;
- optional ball-to-ball collisions;
- high launch speeds that would expose tunnelling in a sampled simulation.

For many of these interactions, the collision time can be obtained directly from the intersection of known trajectories and geometric boundaries. The first prototype should therefore be capable of jumping from one calculated impact to the next without requiring a conventional physics tick.

The prototype is successful when:

- a ball cannot pass through a peg or wall because of its speed;
- every movement interval is either proven collision-free or terminated by an identified event;
- collisions produce plausible new paths;
- repeated events remain performant enough for an interactive visualisation;
- the same headless simulation state can be rendered by a replaceable frontend.

## Longer-term applications

The project may later expand to other bounded mechanical simulations.

### Dice

Support convex dice such as d4, d6, d8, d10, d12 and d20 using:

- ballistic centre-of-mass motion;
- continuous rigid rotational paths;
- earliest-contact solving against clean container geometry;
- collision impulses that update both linear and angular motion;
- explicit transitions into sliding, rolling and resting states.

The different dice should be shape data supplied to a common convex-body model, not separate simulation systems.

### Roulette

Model a ball interacting with prescribed rotating geometry:

- a ballistic or constrained ball path;
- a wheel whose future rotation is already known;
- moving surface velocity at contact points;
- slopes, rings, deflectors, pocket separators and boundaries represented by clean physical primitives;
- transitions between free flight, bouncing, rolling and settling.

The wheel is primarily a known moving environment rather than a second unconstrained dynamic body.

## Motion modes

A complete simulator will likely need several forms of continuous evolution rather than one universal equation:

```text
Free motion
  → search for the next impact

Impact
  → apply an impulse and create a new state

Rolling or sliding contact
  → evolve under contact constraints
  → search for an obstacle or mode-change event

Resting
  → remain stationary until an external event changes the state
```

This allows isolated impacts to remain truly event-driven while recognising that sustained contact is not merely an infinite series of increasingly tiny bounces.

## Correctness philosophy

The central invariant is:

> The simulator must not advance through motion it has not established to be collision-free.

Numerical methods and tolerances will still be necessary, especially for nonlinear rotating shapes. The intended failure policy is conservative:

- uncertainty may cause additional calculation;
- contact may be reported microscopically early within a declared tolerance;
- pathological cases may pause or return an unresolved result;
- uncertainty must not silently become a missed collision.

The project is not attempting infinite mathematical precision. It is attempting a stronger and more transparent correctness contract than a general-purpose game physics engine that must always finish a frame.

## Architecture principles

- **Headless simulation:** the simulator owns authoritative physical state and does not render.
- **Continuous trajectory segments:** bodies expose their pose and motion as functions of simulation time within the current segment.
- **Earliest-event scheduling:** future candidate events are solved and the earliest valid event is processed first.
- **Path invalidation:** when an event changes a body's motion, future events derived from its previous path are discarded or recalculated.
- **Analytical solutions where possible:** simple shape pairs should use direct equations rather than generic numerical machinery.
- **Certified numerical solving where necessary:** nonlinear cases should isolate and refine possible roots without crossing unresolved intervals.
- **Clean collision geometry:** physical surfaces should favour explicit primitives and convex forms over decorative render meshes.
- **Bounded ambition:** specialise for a small family of mechanical interactions before considering general-purpose rigid-body physics.

## Non-goals

At least initially, this project is not intended to provide:

- a general replacement for a full game-engine physics system;
- arbitrary triangle-mesh dynamics;
- deformable bodies, fluids, cloth or destruction;
- large stacks of mutually constrained objects;
- deterministic results across different platforms;
- perfectly accurate material deformation at impact;
- a renderer, editor or complete game framework.

The aim is narrower: make a few fast mechanical objects interact with known geometry without allowing speed to turn solid surfaces into suggestions.

## Project status

Early research and prototype planning.

The first implementation target is a minimal Plinko simulation that proves the event-driven loop before the project commits to a larger architecture or technology stack.

## Development

Install dependencies with `npm install`, start the browser prototype with `npm run dev`, and run
the authoritative local quality gate with `npm run check`.

See [the repository quality workflow](docs/workflow.md) for the focused development commands and
the simulation-renderer boundary used by the scaffold.
