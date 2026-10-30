import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('Missing required environment variable: JWT_SECRET');
}

function splitHeader(value = '') {
  const [scheme, token] = value.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export function authenticate(req, res, next) {
  const token = splitHeader(req.header('authorization'));
  if (!token) {
    return res.status(401).json({ error: 'missing_bearer_token' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: String(payload.sub),
      companyId: payload.company_id ? String(payload.company_id) : null,
      branchIds: Array.isArray(payload.branch_ids)
        ? payload.branch_ids.map((branchId) => String(branchId))
        : [],
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    };

    return next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user?.permissions?.includes(permission)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    return next();
  };
}
