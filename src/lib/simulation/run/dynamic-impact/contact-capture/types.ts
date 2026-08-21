import type { ContactCaptureDiagnostic, Vec2 } from '../../../contracts';

export interface ContactCaptureBody {
	readonly id: string;
	readonly mass: number;
	readonly incomingVelocity: Vec2;
	readonly freeAcceleration: Vec2;
}

export type ContactCaptureContact =
	| {
			readonly id: string;
			readonly type: 'body-fixed';
			readonly bodyId: string;
			readonly normal: Vec2;
			readonly curvatureRadius: number | null;
	  }
	| {
			readonly id: string;
			readonly type: 'body-body';
			readonly firstBodyId: string;
			readonly secondBodyId: string;
			readonly normalFromFirstToSecond: Vec2;
			readonly curvatureRadius: number;
	  };

export interface ContactCaptureEndpointContact {
	readonly contactId: string;
	readonly impulse: number;
	readonly preImpactNormalVelocity: number;
	readonly postImpactNormalVelocity: number;
}

export interface ContactCaptureEndpoint {
	readonly bodyVelocities: readonly { readonly bodyId: string; readonly velocity: Vec2 }[];
	readonly contacts: readonly ContactCaptureEndpointContact[];
}

export interface ContactCaptureInput {
	readonly bodies: readonly ContactCaptureBody[];
	readonly contacts: readonly ContactCaptureContact[];
	readonly ordinary: ContactCaptureEndpoint;
	readonly inelastic: ContactCaptureEndpoint;
	readonly contactCaptureDistance: number;
	readonly numericalTolerance: number;
	readonly solveInelastic: (contactIds: readonly string[]) => ContactCaptureEndpoint | null;
}

export interface ContactCaptureResult {
	readonly endpoint: ContactCaptureEndpoint;
	readonly retainedContactIds: readonly string[];
	readonly releasedContactIds: readonly string[];
	readonly diagnostic: ContactCaptureDiagnostic;
}
