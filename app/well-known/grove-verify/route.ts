// noop placeholder so Next doesn't 404 the well-known path on grove.so itself
import { NextResponse } from 'next/server';
export function GET() { return new NextResponse('ok'); }
