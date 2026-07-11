declare global {
	namespace Express {
		interface Locals {
			traceId?: string;
		}
	}
}

export {};
