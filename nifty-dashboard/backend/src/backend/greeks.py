# greeks.py
import math
from scipy.stats import norm

def bs_price(S, K, r, sigma, t, option_type='call', q=0.0):
    if t<=0 or sigma<=0:
        if option_type=='call': return max(0, S-K)
        return max(0, K-S)
    d1 = (math.log(S/K) + (r - q + 0.5*sigma**2)*t) / (sigma*math.sqrt(t))
    d2 = d1 - sigma*math.sqrt(t)
    if option_type=='call':
        return S*math.exp(-q*t)*norm.cdf(d1) - K*math.exp(-r*t)*norm.cdf(d2)
    else:
        return K*math.exp(-r*t)*norm.cdf(-d2) - S*math.exp(-q*t)*norm.cdf(-d1)

def bs_delta(S,K,r,sigma,t,option_type='call',q=0.0):
    if t<=0 or sigma<=0:
        return 1.0 if (option_type=='call' and S>K) else 0.0
    d1 = (math.log(S/K) + (r - q + 0.5*sigma**2)*t) / (sigma*math.sqrt(t))
    if option_type=='call':
        return math.exp(-q*t) * norm.cdf(d1)
    else:
        return math.exp(-q*t) * (norm.cdf(d1)-1)

def bs_gamma(S,K,r,sigma,t,q=0.0):
    if t<=0 or sigma<=0: return 0.0
    d1 = (math.log(S/K) + (r - q + 0.5*sigma**2)*t) / (sigma*math.sqrt(t))
    return (math.exp(-q*t) * norm.pdf(d1)) / (S * sigma * math.sqrt(t))

def bs_theta(S,K,r,sigma,t,option_type='call',q=0.0):
    if t<=0: return 0.0
    d1 = (math.log(S/K) + (r - q + 0.5*sigma**2)*t) / (sigma*math.sqrt(t))
    d2 = d1 - sigma*math.sqrt(t)
    term1 = - (S * sigma * math.exp(-q*t) * norm.pdf(d1)) / (2 * math.sqrt(t))
    if option_type=='call':
        term2 = q * S * math.exp(-q*t) * norm.cdf(d1)
        term3 = - r * K * math.exp(-r*t) * norm.cdf(d2)
        return (term1 + term2 + term3) / 365.0
    else:
        term2 = - q * S * math.exp(-q*t) * norm.cdf(-d1)
        term3 = r * K * math.exp(-r*t) * norm.cdf(-d2)
        return (term1 + term2 + term3) / 365.0
